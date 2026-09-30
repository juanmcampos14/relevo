import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Dimension, Gap } from "@/domain/readiness";
import { GAPS, metrics as evidenceMetrics, type EvidenceLink } from "@/domain/readiness";
import { ECONOMICS, type EconomicFact } from "@/domain/economics";
import { STAGE_LABEL, caseStage, opportunityCriteria } from "@/domain/case";
import { BASIS, CHANNEL, evidenceProvenance, isStrongSource } from "@/domain/provenance";
import { companyName } from "@/server/entities";
import { qualityChecks } from "@/server/quality";
import type { ToolContext } from "./tools";

// Herramientas de conocimiento del asistente: la memoria completa (no solo la pantalla actual), con la
// procedencia de cada dato. Todas son de lectura; open_page solo navega.

const ref = (type: string, id: string) => `${type}:${id}`;
const clip = (s: string | null | undefined, n = 400) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? null);
const strict = <T extends Record<string, unknown>>(properties: T, required: (keyof T)[] = []) => ({ type: "object" as const, properties, required: required as string[], additionalProperties: false });

export const KNOWLEDGE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find",
    description: "Búsqueda global en la memoria: empresas, activos, establecimientos, personas (por nombre o cargo), hipótesis, evidencia (por texto: p. ej. 'reintegro', '18.000'), capturas y entidades sin identificar. Usala antes de afirmar que algo no existe.",
    input_schema: strict({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "list_hypotheses",
    description: "Hipótesis, findings y casos con su etapa (señal, en validación, caso, oportunidad), casos independientes, contraevidencia, faltantes, economía conocida y qué les falta para ser oportunidad. Filtros: maturity, with_economics, missing_buyer, include_inactive.",
    input_schema: strict({
      maturity: { type: "string", enum: ["idea", "hipotesis", "finding", "caso", "todas"] },
      with_economics: { type: "boolean" },
      missing_buyer: { type: "boolean" },
      include_inactive: { type: "boolean", description: "Incluir casos pausados, cerrados o descartados" },
    }),
  },
  {
    name: "get_hypothesis",
    description: "Estado completo de una hipótesis 'finding:uuid': qué sabemos / creemos / contradice / falta (dimensiones), evidencia con canal y base (observado, declarado, documentado…), economía, criterios de oportunidad, validaciones, pedidos de ayuda e historia (reformulaciones, cambios de estado).",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "get_capture",
    description: "Una captura 'capture:uuid': texto, resumen, qué todavía no sabemos, propuestas y su estado, evidencia que dejó (con canal y base) y si es duplicado de otra.",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "get_person",
    description: "Una persona 'contact:uuid': con quién está, qué afirmó (cada dato con su evidencia, canal y base), acciones y de dónde salió.",
    input_schema: strict({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "changes_since",
    description: "Qué cambió en los últimos N días: evidencia nueva (y a qué hipótesis afecta), hipótesis nuevas, reformulaciones, contraevidencia, cambios de estado, capturas procesadas, decisiones y pedidos de ayuda.",
    input_schema: strict({ days: { type: "integer", minimum: 1, maximum: 90 } }, ["days"]),
  },
  {
    name: "quality_checks",
    description: "Alarmas de calidad: personas sin empresa, actividades sin entidad, fuentes sin URL, empresas sin fuente, evidencia vencida, prioridad alta sin responsable o sin próxima acción, oportunidades sin comprador o sin economía, casos sin hito, contradicciones sin resolver, posibles duplicados.",
    input_schema: strict({}),
  },
  {
    name: "upcoming_agenda",
    description: "Agenda de los próximos N días: visitas planificadas con sus paradas y tareas que vencen (incluidas validaciones de hipótesis). Sirve para preparar reuniones.",
    input_schema: strict({ days: { type: "integer", minimum: 1, maximum: 30 } }, ["days"]),
  },
  {
    name: "pending_for_team",
    description: "Qué espera a cada persona del equipo: decisiones por votar y pedidos de ayuda abiertos (a quién, qué, para qué caso).",
    input_schema: strict({}),
  },
  {
    name: "list_members",
    description: "Miembros del workspace con su referencia 'member:uuid' (para proponer un pedido de ayuda).",
    input_schema: strict({}),
  },
  {
    name: "open_page",
    description: "Lleva al usuario a una pantalla: una referencia 'tipo:uuid' (empresa, activo, persona, hipótesis, captura, oportunidad…) o una vista ('hoy', 'ejecutiva', 'red', 'personas', 'evidencia', 'calidad', 'actividades', 'capturas', 'sin_identificar'). Usala cuando el usuario pide ir, abrir o mostrar algo.",
    input_schema: strict({ target: { type: "string" }, query: { type: "string", description: "Filtro de búsqueda para vistas de lista (opcional)" } }, ["target"]),
  },
];

export const KNOWLEDGE_TOOL_NAMES = new Set(KNOWLEDGE_TOOLS.map((t) => t.name));

const Str = z.string();
const provenanceOf = (e: { origin_kind: string; verification_status: string; declared_by: string | null }, speaker?: string | null) => {
  const p = evidenceProvenance({ ...e, speaker });
  return { channel: CHANNEL[p.channel], basis: BASIS[p.basis], detail: p.detail ?? null };
};
const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function track(ctx: ToolContext, value: unknown) {
  const text = JSON.stringify(value);
  for (const m of text.matchAll(/"ref":"([a-z]+:[0-9a-f-]{36})"/g)) ctx.seenRefs.add(m[1]);
  return text;
}

export async function runKnowledgeTool(name: string, a: Record<string, unknown>, ctx: ToolContext): Promise<{ content: string; isError?: boolean }> {
  const { db } = ctx;
  const base = `/w/${ctx.slug}`;
  switch (name) {
    case "find": {
      const q = Str.min(2).safeParse(a.query);
      if (!q.success) return { content: "La búsqueda necesita al menos 2 letras", isError: true };
      const term = `%${q.data.replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ")}%`;
      const [c, as, es, ct, f, ev, cap, u] = await Promise.all([
        db.from("companies").select("id, trade_name, legal_name, activity, locality").or(`trade_name.ilike.${term},legal_name.ilike.${term},activity.ilike.${term}`).limit(10),
        db.from("assets").select("id, title, kind, operation, locality").or(`title.ilike.${term},address_text.ilike.${term}`).limit(10),
        db.from("establishments").select("id, name, address_text").or(`name.ilike.${term},address_text.ilike.${term}`).limit(10),
        db.from("contacts").select("id, full_name, role_title, contact_kind").or(`full_name.ilike.${term},role_title.ilike.${term}`).limit(10),
        db.from("findings").select("id, statement, maturity, case_status").ilike("statement", term).neq("review_status", "rechazado").limit(10),
        db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, capture_id, company_id").ilike("statement", term).limit(12),
        db.from("captures").select("id, captured_at, ai_summary, status").or(`body.ilike.${term},ai_summary.ilike.${term}`).limit(8),
        db.from("unresolved_entities").select("id, kind, label").ilike("label", term).is("resolved_at", null).limit(8),
      ]);
      return {
        content: track(ctx, {
          companies: (c.data ?? []).map((x) => ({ ref: ref("company", x.id), name: companyName(x), activity: x.activity, locality: x.locality })),
          assets: (as.data ?? []).map((x) => ({ ref: ref("asset", x.id), name: x.title, kind: x.kind, operation: x.operation, locality: x.locality })),
          establishments: (es.data ?? []).map((x) => ({ ref: ref("establishment", x.id), name: x.name, address: x.address_text })),
          people: (ct.data ?? []).map((x) => ({ ref: ref("contact", x.id), name: x.full_name, role: x.role_title, kind: x.contact_kind })),
          hypotheses: (f.data ?? []).map((x) => ({ ref: ref("finding", x.id), statement: x.statement, maturity: x.maturity, case_status: x.case_status })),
          evidence: (ev.data ?? []).map((x) => ({ ref: ref("evidence", x.id), statement: x.statement, provenance: provenanceOf(x), capture: x.capture_id ? { ref: ref("capture", x.capture_id) } : null, company: x.company_id ? { ref: ref("company", x.company_id) } : null })),
          captures: (cap.data ?? []).map((x) => ({ ref: ref("capture", x.id), captured_at: x.captured_at, summary: clip(x.ai_summary, 200), status: x.status })),
          unidentified: (u.data ?? []).map((x) => ({ kind: x.kind, label: x.label, note: "entidad sin identificar (organización o persona real todavía desconocida)" })),
        }),
      };
    }
    case "list_hypotheses": {
      let q = db
        .from("findings")
        .select("id, statement, maturity, case_status, finding_assessments(created_at, summary, gaps, dimensions, economics, independent_cases, contradicts), opportunity_findings(opportunities(status))")
        .neq("review_status", "rechazado")
        .limit(100);
      if (typeof a.maturity === "string" && a.maturity !== "todas") q = q.eq("maturity", a.maturity);
      if (a.include_inactive !== true) q = q.eq("case_status", "activo");
      const { data } = await q;
      const rows = (data ?? []).map((f) => {
        const as = [...f.finding_assessments].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
        const dims = (as?.dimensions ?? []) as unknown as Dimension[];
        const gaps = (as?.gaps ?? []) as Gap[];
        const economics = (as?.economics ?? []) as unknown as EconomicFact[];
        const cases = as?.independent_cases ?? 0;
        const crit = opportunityCriteria({ dims, gaps, metrics: { independentCases: cases, contradicts: as?.contradicts ?? 0 }, economics, nextMilestone: "—" });
        const buyer = dims.some((d) => (d.key === "comprador" || d.key === "decisor") && d.status === "sabido");
        return {
          ref: ref("finding", f.id),
          statement: f.statement,
          stage: STAGE_LABEL[caseStage({ maturity: f.maturity, independentCases: cases, hasOpportunity: f.opportunity_findings.some((o) => o.opportunities && o.opportunities.status !== "rechazada") })],
          case_status: f.case_status,
          independent_cases: cases,
          contradicting: as?.contradicts ?? 0,
          summary: clip(as?.summary, 300),
          gaps: gaps.map((g) => GAPS[g]?.label ?? g),
          economics: economics.map((e) => ({ variable: ECONOMICS[e.variable], value: e.value, basis: e.basis === "estimado" ? "inferido (estimación)" : e.basis, formula: e.formula })),
          buyer_known: buyer,
          missing_for_opportunity: crit.items.filter((i) => !i.ok && i.key !== "hito").map((i) => i.label),
          assessed: !!as,
        };
      });
      const filtered = rows.filter((r) => (a.with_economics === true ? r.economics.some((e) => !e.basis.startsWith("inferido")) : true) && (a.missing_buyer === true ? !r.buyer_known : true));
      return { content: track(ctx, filtered) };
    }
    case "get_hypothesis": {
      const m = Str.regex(/^finding:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'finding:uuid'", isError: true };
      const id = m.data.split(":")[1];
      const [{ data: f }, { data: as }, { data: revs }, { data: helps }, { data: props }, { data: tasks }] = await Promise.all([
        db.from("findings").select("id, statement, maturity, case_status, kind, analysis, created_at, finding_evidence(stance, evidence(id, statement, quote, origin_kind, verification_status, declared_by, observed_at, capture_id, company_id, stated_by_contact_id, visit_id, source_id, about_unresolved_id, stated_by_unresolved_id, stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name, role_title)))").eq("id", id).maybeSingle(),
        db.from("finding_assessments").select("created_at, summary, gaps, dimensions, economics").eq("finding_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("finding_revisions").select("kind, relation, previous_value, new_value, reason, created_at").eq("finding_id", id).order("created_at"),
        db.from("help_requests").select("kind, ask, status, result").eq("finding_id", id),
        db.from("proposals").select("payload, status").eq("finding_id", id).eq("status", "propuesta"),
        db.from("tasks").select("id, title, status, due_on").eq("finding_id", id),
      ]);
      if (!f) return { content: "No encontrado o sin acceso", isError: true };
      const rows = f.finding_evidence.filter((x) => x.evidence);
      const links = rows.map((x) => ({ ...x.evidence!, stance: x.stance })) as unknown as EvidenceLink[];
      const m2 = evidenceMetrics(links, new Date().toISOString().slice(0, 10));
      const dims = (as?.dimensions ?? []) as unknown as Dimension[];
      const economics = (as?.economics ?? []) as unknown as EconomicFact[];
      const milestone = tasks?.find((t) => t.status !== "done")?.title ?? (props?.[0]?.payload as { title?: string } | undefined)?.title ?? null;
      const crit = opportunityCriteria({ dims, gaps: (as?.gaps ?? []) as Gap[], metrics: m2, economics, nextMilestone: milestone, strongSources: rows.filter((r) => r.stance === "supports" && isStrongSource(r.evidence!)).length });
      return {
        content: track(ctx, {
          ref: ref("finding", id),
          statement: f.statement,
          maturity: f.maturity,
          case_status: f.case_status,
          counts: { supports: m2.supports, contradicts: m2.contradicts, independent_cases: m2.independentCases },
          assessment: as ? { at: as.created_at, summary: as.summary, dimensions: dims.map((d) => ({ dimension: d.key, status: d.status, summary: d.summary, evidence: d.evidence_ids.map((e) => ({ ref: ref("evidence", e) })) })), gaps: ((as.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.label ?? g) } : "sin evaluar todavía",
          economics: economics.map((e) => ({ variable: ECONOMICS[e.variable], value: e.value, basis: e.basis === "estimado" ? "inferido (estimación)" : e.basis, formula: e.formula, evidence: e.evidence_ids.map((x) => ({ ref: ref("evidence", x) })) })),
          opportunity_criteria: crit.items.map((i) => ({ criterion: i.label, met: i.ok, detail: i.detail })),
          evidence: rows.map((r) => ({
            ref: ref("evidence", r.evidence!.id),
            stance: r.stance,
            statement: r.evidence!.statement,
            quote: clip(r.evidence!.quote, 200),
            provenance: provenanceOf(r.evidence!, r.evidence!.stated_by?.full_name),
            observed_at: r.evidence!.observed_at,
            capture: r.evidence!.capture_id ? { ref: ref("capture", r.evidence!.capture_id) } : null,
          })),
          next_validations: [...(tasks ?? []).filter((t) => t.status !== "done").map((t) => ({ ref: ref("task", t.id), title: t.title, due_on: t.due_on, scheduled: true })), ...(props ?? []).map((p) => ({ title: (p.payload as { title?: string }).title, scheduled: false }))],
          help_requests: helps ?? [],
          history: (revs ?? []).map((r) => ({ at: r.created_at, kind: r.kind, relation: r.relation, from: r.previous_value, to: r.new_value, reason: r.reason })),
        }),
      };
    }
    case "get_capture": {
      const m = Str.regex(/^capture:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'capture:uuid'", isError: true };
      const id = m.data.split(":")[1];
      const [{ data: c }, { data: props }, { data: ev }] = await Promise.all([
        db.from("captures").select("id, captured_at, body, ai_summary, ai_unknowns, status, duplicate_of, transcripts(text)").eq("id", id).maybeSingle(),
        db.from("proposals").select("kind, status, payload").eq("capture_id", id).order("position"),
        db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, media_start_ms, stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name)").eq("capture_id", id),
      ]);
      if (!c) return { content: "No encontrado o sin acceso", isError: true };
      return {
        content: track(ctx, {
          ref: ref("capture", id),
          captured_at: c.captured_at,
          status: c.status,
          duplicate_of: c.duplicate_of ? { ref: ref("capture", c.duplicate_of), note: "misma conversación: no cuenta como fuente nueva" } : null,
          note: clip(c.body, 1500),
          transcript: clip(c.transcripts.map((t) => t.text).filter(Boolean).join("\n"), 3000),
          summary: c.ai_summary,
          unknowns: c.ai_unknowns,
          proposals: (props ?? []).map((p) => ({ kind: p.kind, status: p.status, what: String((p.payload as Record<string, unknown>).statement ?? (p.payload as Record<string, unknown>).name ?? (p.payload as Record<string, unknown>).title ?? (p.payload as Record<string, unknown>).role ?? "") })),
          evidence: (ev ?? []).map((e) => ({ ref: ref("evidence", e.id), statement: e.statement, provenance: provenanceOf(e, e.stated_by?.full_name), audio_second: e.media_start_ms != null ? Math.floor(e.media_start_ms / 1000) : null })),
        }),
      };
    }
    case "get_person": {
      const m = Str.regex(/^contact:([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'contact:uuid'", isError: true };
      const id = m.data.split(":")[1];
      const [{ data: c }, { data: said }, { data: tasks }] = await Promise.all([
        db.from("contacts").select("id, full_name, role_title, contact_kind, contact_permission, relationship_status, contact_links(companies(id, trade_name, legal_name))").eq("id", id).maybeSingle(),
        db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, observed_at, capture_id").eq("stated_by_contact_id", id).limit(40),
        db.from("tasks").select("id, title, status, due_on").eq("contact_id", id),
      ]);
      if (!c) return { content: "No encontrado o sin acceso", isError: true };
      return {
        content: track(ctx, {
          ref: ref("contact", id),
          name: c.full_name, role: c.role_title, kind: c.contact_kind, may_contact: c.contact_permission, relationship: c.relationship_status,
          companies: c.contact_links.flatMap((l) => (l.companies ? [{ ref: ref("company", l.companies.id), name: companyName(l.companies) }] : [])),
          stated: (said ?? []).map((e) => ({ ref: ref("evidence", e.id), statement: e.statement, provenance: provenanceOf(e, c.full_name), observed_at: e.observed_at, capture: e.capture_id ? { ref: ref("capture", e.capture_id) } : null })),
          tasks: (tasks ?? []).map((t) => ({ ref: ref("task", t.id), title: t.title, status: t.status, due_on: t.due_on })),
        }),
      };
    }
    case "changes_since": {
      const days = typeof a.days === "number" ? Math.min(Math.max(a.days, 1), 90) : 7;
      const s = since(days);
      const [{ data: ev }, { data: nf }, { data: revs }, { data: caps }, { data: dec }, { data: helps }] = await Promise.all([
        db.from("finding_evidence").select("stance, created_at, findings(id, statement), evidence(id, statement, origin_kind, verification_status, declared_by)").gte("created_at", s).order("created_at", { ascending: false }).limit(40),
        db.from("findings").select("id, statement, maturity, review_status, created_at").gte("created_at", s).neq("review_status", "rechazado").limit(20),
        db.from("finding_revisions").select("kind, relation, previous_value, new_value, reason, created_at, findings(id, statement)").gte("created_at", s).limit(20),
        db.from("captures").select("id, captured_at, status, ai_summary").gte("captured_at", s).order("captured_at", { ascending: false }).limit(20),
        db.from("decisions").select("id, question, status, decided_at, created_at").or(`created_at.gte.${s},decided_at.gte.${s}`).limit(20),
        db.from("help_requests").select("kind, ask, status, result, updated_at").gte("updated_at", s).limit(20),
      ]);
      return {
        content: track(ctx, {
          window_days: days,
          evidence_linked: (ev ?? []).map((x) => ({ stance: x.stance, at: x.created_at, hypothesis: x.findings ? { ref: ref("finding", x.findings.id), statement: x.findings.statement } : null, evidence: x.evidence ? { ref: ref("evidence", x.evidence.id), statement: x.evidence.statement, provenance: provenanceOf(x.evidence) } : null })),
          new_hypotheses: (nf ?? []).map((x) => ({ ref: ref("finding", x.id), statement: x.statement, maturity: x.maturity, pending_review: x.review_status === "pendiente_revision" })),
          revisions: (revs ?? []).map((r) => ({ at: r.created_at, kind: r.kind, relation: r.relation, from: r.previous_value, to: r.new_value, reason: r.reason, hypothesis: r.findings ? { ref: ref("finding", r.findings.id) } : null })),
          captures: (caps ?? []).map((c) => ({ ref: ref("capture", c.id), at: c.captured_at, status: c.status, summary: clip(c.ai_summary, 160) })),
          decisions: (dec ?? []).map((d) => ({ ref: ref("decision", d.id), question: d.question, status: d.status })),
          help_requests: helps ?? [],
        }),
      };
    }
    case "quality_checks": {
      const checks = await qualityChecks(db, ctx.slug, new Date().toISOString().slice(0, 10));
      return { content: track(ctx, checks.filter((c) => c.items.length).map((c) => ({ check: c.label, why: c.why, count: c.items.length, examples: c.items.slice(0, 5).map((i) => ({ ...(/^(company|contact|finding|opportunity|source|task|capture|evidence):/.test(i.ref) ? { ref: i.ref } : {}), label: i.label })) }))) };
    }
    case "upcoming_agenda": {
      const days = typeof a.days === "number" ? a.days : 2;
      const today = new Date().toISOString().slice(0, 10);
      const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const [{ data: plans }, { data: tasks }] = await Promise.all([
        db.from("visit_plans").select("id, title, planned_on, visit_stops(id, target_time, status, campaign_targets(next_action, companies(id, trade_name, legal_name), establishments(id, name), assets(id, title)))").gte("planned_on", today).lte("planned_on", until).order("planned_on"),
        db.from("tasks").select("id, title, due_on, kind, finding_id, findings(statement), contacts(id, full_name)").neq("status", "done").gte("due_on", today).lte("due_on", until).order("due_on"),
      ]);
      return {
        content: track(ctx, {
          visits: (plans ?? []).map((p) => ({ title: p.title, date: p.planned_on, stops: p.visit_stops.map((s) => { const t = s.campaign_targets; return { time: s.target_time, status: s.status, next_action: t?.next_action, place: t?.companies ? { ref: ref("company", t.companies.id), name: companyName(t.companies) } : t?.establishments ? { ref: ref("establishment", t.establishments.id), name: t.establishments.name } : t?.assets ? { ref: ref("asset", t.assets.id), name: t.assets.title } : null }; }) })),
          tasks: (tasks ?? []).map((t) => ({ ref: ref("task", t.id), title: t.title, due_on: t.due_on, kind: t.kind, validates: t.finding_id ? { ref: ref("finding", t.finding_id), statement: t.findings?.statement } : null, with: t.contacts ? { ref: ref("contact", t.contacts.id), name: t.contacts.full_name } : null })),
        }),
      };
    }
    case "pending_for_team": {
      const [{ data: dec }, { data: helps }, { data: profiles }] = await Promise.all([
        db.from("decisions").select("id, question, due_on, opportunity_id").eq("status", "requested"),
        db.from("help_requests").select("kind, ask, target, due_on, status, assignee_id, finding_id").in("status", ["abierto", "en_curso"]),
        db.from("profiles").select("user_id, display_name, email"),
      ]);
      const name = (id: string | null) => profiles?.find((p) => p.user_id === id)?.display_name ?? profiles?.find((p) => p.user_id === id)?.email ?? "—";
      return {
        content: track(ctx, {
          decisions_to_vote: (dec ?? []).map((d) => ({ ref: ref("decision", d.id), question: d.question, due_on: d.due_on, opportunity: d.opportunity_id ? { ref: ref("opportunity", d.opportunity_id) } : null, note: "votan quienes aprueban decisiones" })),
          help_requests: (helps ?? []).map((h) => ({ for: name(h.assignee_id), kind: h.kind, ask: h.ask, target: h.target, due_on: h.due_on, status: h.status, case: h.finding_id ? { ref: ref("finding", h.finding_id) } : null })),
        }),
      };
    }
    case "list_members": {
      const { data } = await db.from("profiles").select("user_id, display_name, email");
      return { content: track(ctx, (data ?? []).map((p) => ({ ref: ref("member", p.user_id), name: p.display_name || p.email }))) };
    }
    case "open_page": {
      const target = String(a.target ?? "").trim();
      const q = typeof a.query === "string" && a.query.trim() ? `?q=${encodeURIComponent(a.query.trim())}` : "";
      const views: Record<string, string> = {
        hoy: base, ejecutiva: base, red: `${base}/explorar`, personas: `${base}/explorar/personas${q}`, evidencia: `${base}/explorar/evidencia${q}`, calidad: `${base}/explorar/calidad`,
        actividades: `${base}/explorar/actividades`, capturas: `${base}/capturas`, sin_identificar: `${base}/explorar/sin-identificar`, empresas: `${base}/explorar/registros${q}`,
      };
      let href: string | null = views[target] ?? null;
      const m = target.match(/^([a-z]+):([0-9a-f-]{36})$/);
      if (m) {
        if (!ctx.seenRefs.has(target)) return { content: "Esa referencia no salió de ninguna consulta: buscala primero.", isError: true };
        const [, t, id] = m;
        href = t === "company" || t === "establishment" || t === "asset" ? `${base}/e/${t}/${id}` : t === "contact" ? `${base}/explorar/personas/${id}` : t === "finding" ? `${base}/hallazgos/${id}` : t === "capture" ? `${base}/capturas/${id}` : t === "opportunity" ? `${base}/oportunidades/o/${id}` : t === "campaign" ? `${base}/explorar/c/${id}` : null;
      }
      if (!href) return { content: `No sé abrir '${target}'.`, isError: true };
      ctx.navigate?.(href);
      return { content: `Listo: se abre ${href} para el usuario.` };
    }
    default:
      return { content: `Herramienta desconocida: ${name}`, isError: true };
  }
}
