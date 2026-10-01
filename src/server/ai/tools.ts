import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { dealflowStage, findingKind, opportunityStatus, reviewStatus, targetStatus } from "@/domain/catalogs";
import { companyName } from "@/server/entities";
import { DRAFT_ACTIONS, HELP_KINDS, ProposeActionInput } from "./drafts";
import { KNOWLEDGE_TOOLS, KNOWLEDGE_TOOL_NAMES, runKnowledgeTool } from "./tools-knowledge";

type Db = SupabaseClient<Database>;

/** Tipos de referencia citables: [[tipo:uuid]]. */
export const REF_TYPES = [
  "company", "establishment", "asset", "contact", "finding", "opportunity", "visit", "decision", "source", "campaign", "task", "news", "capture", "evidence", "document",
] as const;
export type RefType = (typeof REF_TYPES)[number];
export const REF_PATTERN = /\[\[(company|establishment|asset|contact|finding|opportunity|visit|decision|source|campaign|task|news|capture|evidence|document):([0-9a-f-]{36})\]\]/g;

const ref = (type: RefType, id: string) => `${type}:${id}`;
const clip = (s: string | null | undefined, n = 1500) => (s && s.length > n ? `${s.slice(0, n)}… [recortado]` : s ?? null);

// ---------------------------------------------------------------------------------
// Definiciones (orden y contenido estables: son parte del prefijo cacheado)
// ---------------------------------------------------------------------------------

const strict = <T extends Record<string, unknown>>(properties: T, required: (keyof T)[] = []) => ({
  type: "object" as const,
  properties,
  required: required as string[],
  additionalProperties: false,
});

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: "campaign_overview",
    description:
      "Resumen de campañas del workspace: verticales, cantidad de objetivos por estado y lista de objetivos (empresa, establecimiento o activo) con su referencia. Usala para orientarte antes de responder sobre el trabajo de campo.",
    input_schema: strict({}),
  },
  {
    name: "search_records",
    description:
      "Busca empresas, establecimientos, activos y contactos por nombre o dirección. Devuelve referencias citables.",
    input_schema: strict({ query: { type: "string", description: "Texto a buscar (mínimo 2 letras)" } }, ["query"]),
  },
  {
    name: "get_record",
    description:
      "Detalle de un registro por referencia 'tipo:uuid' (company, establishment, asset, contact, opportunity, visit, finding, decision): datos, fuentes, afirmaciones con su estado de verificación, visitas, hallazgos y vínculos.",
    input_schema: strict({ ref: { type: "string", description: "Referencia 'tipo:uuid'" } }, ["ref"]),
  },
  {
    name: "list_findings",
    description:
      "Lista hallazgos (findings) con su tipo, estado de verificación, estado de revisión humana, fuente y registro vinculado.",
    input_schema: strict({
      review_status: { type: "string", enum: ["pendiente_revision", "aprobado", "rechazado", "todos"] },
      kind: { type: "string", enum: [...findingKind.values, "todos"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    }),
  },
  {
    name: "list_opportunities",
    description: "Lista oportunidades (candidatas, aprobadas en dealflow o rechazadas) con etapa y cantidad de hallazgos que las sustentan.",
    input_schema: strict({ status: { type: "string", enum: ["candidata", "aprobada", "rechazada", "todas"] } }),
  },
  {
    name: "list_visits",
    description: "Lista visitas de campo recientes con el registro visitado y un extracto de las notas.",
    input_schema: strict({ since_days: { type: "integer", minimum: 1, maximum: 365 } }),
  },
  {
    name: "list_decisions",
    description: "Lista decisiones (pendientes o tomadas) con su pregunta, estado y oportunidad asociada.",
    input_schema: strict({ status: { type: "string", enum: ["requested", "approved", "rejected", "deferred", "todas"] } }),
  },
  {
    name: "list_news",
    description:
      "Noticias recientes que nombran 'Vaca Muerta' o 'Añelo' (radar del workspace), con medio, fecha y enlace. Son fuentes públicas sin verificar: una noticia no prueba demanda ni un acuerdo.",
    input_schema: strict({
      contains: { type: "string", description: "Filtrar por texto en el título (opcional)" },
      limit: { type: "integer", minimum: 1, maximum: 40 },
    }),
  },
  {
    name: "propose_action",
    description:
      "Registra una PROPUESTA de cambio para que una persona la vea (qué cambia, por qué, evidencia, riesgo de duplicado) y la apruebe o rechace. No ejecuta nada. Acciones: create_task, prepare_validation (validación de una hipótesis: finding_ref), link_evidence (evidence_ref + finding_ref + stance), update_next_action (entity_ref + next_action), request_help (assignee_ref de list_members + help_kind + title con lo concreto que se pide; finding_ref si es sobre un caso), draft_finding (source_ref + statement; queda pendiente de revisión), request_decision (title), record_web_evidence (url + source_title + statement con lo que dice esa fuente; finding_ref + stance si apoya o contradice una hipótesis). NO existen acciones para promover oportunidades, fusionar personas, confirmar reuniones, enviar mensajes, cambiar economía ni descartar casos: eso lo hace una persona.",
    input_schema: strict(
      {
        action: { type: "string", enum: [...DRAFT_ACTIONS] },
        title: { type: "string", description: "Tarea, validación, pedido de ayuda o pregunta de la decisión" },
        statement: { type: "string", description: "Texto de la hipótesis (draft_finding)" },
        finding_kind: { type: "string", enum: [...findingKind.values] },
        source_ref: { type: "string", description: "source:uuid (draft_finding)" },
        entity_ref: { type: "string", description: "company|establishment|asset:uuid" },
        opportunity_ref: { type: "string" },
        finding_ref: { type: "string", description: "finding:uuid" },
        evidence_ref: { type: "string", description: "evidence:uuid" },
        contact_ref: { type: "string", description: "contact:uuid (persona involucrada)" },
        stance: { type: "string", enum: ["supports", "contradicts", "contextual"] },
        next_action: { type: "string" },
        assignee_ref: { type: "string", description: "member:uuid (request_help)" },
        help_kind: { type: "string", enum: [...HELP_KINDS] },
        help_target: { type: "string", description: "A quién se busca (request_help, opcional)" },
        due_on: { type: "string", description: "AAAA-MM-DD (opcional)" },
        url: { type: "string", description: "URL de la fuente web (record_web_evidence)" },
        source_title: { type: "string", description: "Título de la fuente web (record_web_evidence)" },
        rationale: { type: "string", description: "Por qué se propone" },
        evidence_refs: { type: "array", items: { type: "string" }, description: "Referencias 'tipo:uuid' que la sustentan" },
      },
      ["action", "rationale", "evidence_refs"],
    ),
  },
  ...KNOWLEDGE_TOOLS,
];

export { ProposeActionInput };

// ---------------------------------------------------------------------------------
// Ejecución (solo lectura, con el cliente del usuario → RLS)
// ---------------------------------------------------------------------------------

export type ToolContext = {
  db: Db;
  slug: string;
  /** Si una herramienta lleva al usuario a otra pantalla (open_page). */
  navigate?: (href: string) => void;
  /** Dónde está el usuario ahora (GPS del teléfono), si lo compartió. */
  here?: { lat: number; lng: number; accuracy?: number } | null;
  workspaceId?: string;
  userId?: string;
  settings?: unknown;
  /** Proyecto o misión en el que se está trabajando (para que una nota de campo alimente ese proyecto). */
  campaignId?: string | null;
  /** Una nota de campo quedó guardada como captura (el panel muestra lo que entendió RELEVO). */
  onCapture?: (captureId: string) => void;
  /** Referencias devueltas por las herramientas en esta conversación: únicas citables. */
  seenRefs: Set<string>;
  /** Registra un borrador; devuelve su id. */
  saveDraft: (input: z.infer<typeof ProposeActionInput>) => Promise<string>;
};

function track(ctx: ToolContext, value: unknown) {
  const text = JSON.stringify(value);
  for (const m of text.matchAll(/"ref":"([a-z]+:[0-9a-f-]{36})"/g)) ctx.seenRefs.add(m[1]);
  return text;
}

const Str = z.string();
const Obj = z.record(z.string(), z.unknown());

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError?: boolean }> {
  const input = Obj.safeParse(rawInput);
  if (!input.success) return { content: "Entrada inválida", isError: true };
  const a = input.data;
  const { db } = ctx;
  switch (name) {
    case "campaign_overview": {
      const [{ data: campaigns }, { data: targets }] = await Promise.all([
        db.from("campaigns").select("id, name, zone, status, campaign_verticals(verticals(name))"),
        db
          .from("campaign_targets")
          .select("id, campaign_id, status, next_action, companies(id, trade_name, legal_name), establishments(id, name), assets(id, title, kind), target_verticals(verticals(name))")
          .limit(200),
      ]);
      return {
        content: track(ctx, {
          campaigns: (campaigns ?? []).map((c) => ({
            ref: ref("campaign", c.id),
            name: c.name,
            zone: c.zone,
            status: c.status,
            verticals: c.campaign_verticals.map((v) => v.verticals?.name),
            targets: (targets ?? [])
              .filter((t) => t.campaign_id === c.id)
              .map((t) => ({
                ref: t.companies ? ref("company", t.companies.id) : t.establishments ? ref("establishment", t.establishments.id) : ref("asset", t.assets!.id),
                name: t.companies ? companyName(t.companies) : t.establishments?.name ?? t.assets?.title,
                status: targetStatus.label(t.status),
                verticals: t.target_verticals.map((v) => v.verticals?.name),
                next_action: t.next_action,
              })),
          })),
        }),
      };
    }
    case "search_records": {
      const q = Str.min(2).safeParse(a.query);
      if (!q.success) return { content: "La búsqueda necesita al menos 2 letras", isError: true };
      const term = `%${q.data.replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ")}%`;
      const [c, e, as, ct] = await Promise.all([
        db.from("companies").select("id, trade_name, legal_name, verification_status, is_demo").or(`trade_name.ilike.${term},legal_name.ilike.${term}`).limit(10),
        db.from("establishments").select("id, name, address_text, verification_status, is_demo").or(`name.ilike.${term},address_text.ilike.${term}`).limit(10),
        db.from("assets").select("id, title, kind, verification_status, is_demo").or(`title.ilike.${term},address_text.ilike.${term}`).limit(10),
        db.from("contacts").select("id, full_name, role_title, verification_status, is_demo").ilike("full_name", term).limit(10),
      ]);
      return {
        content: track(ctx, [
          ...(c.data ?? []).map((x) => ({ ref: ref("company", x.id), name: companyName(x), verification: x.verification_status, demo: x.is_demo })),
          ...(e.data ?? []).map((x) => ({ ref: ref("establishment", x.id), name: x.name, address: x.address_text, verification: x.verification_status, demo: x.is_demo })),
          ...(as.data ?? []).map((x) => ({ ref: ref("asset", x.id), name: x.title, kind: x.kind, verification: x.verification_status, demo: x.is_demo })),
          ...(ct.data ?? []).map((x) => ({ ref: ref("contact", x.id), name: x.full_name, role: x.role_title, verification: x.verification_status, demo: x.is_demo })),
        ]),
      };
    }
    case "get_record": {
      const m = Str.regex(/^([a-z]+):([0-9a-f-]{36})$/).safeParse(a.ref);
      if (!m.success) return { content: "Referencia inválida: usá 'tipo:uuid'", isError: true };
      const [type, id] = m.data.split(":");
      return getRecord(ctx, type, id);
    }
    case "list_findings": {
      let q = db
        .from("findings")
        .select("id, kind, statement, evidence, verification_status, review_status, origin, created_at, sources(id, title, url), company_id, establishment_id, asset_id, visit_id")
        .order("created_at", { ascending: false })
        .limit(typeof a.limit === "number" ? Math.min(a.limit, 50) : 25);
      if (typeof a.review_status === "string" && a.review_status !== "todos") q = q.eq("review_status", a.review_status);
      if (typeof a.kind === "string" && a.kind !== "todos") q = q.eq("kind", a.kind);
      const { data } = await q;
      return {
        content: track(ctx, (data ?? []).map((f) => ({
          ref: ref("finding", f.id),
          kind: findingKind.label(f.kind),
          statement: f.statement,
          evidence: clip(f.evidence, 500),
          verification: f.verification_status,
          review: reviewStatus.label(f.review_status),
          origin: f.origin,
          source: f.sources ? { ref: ref("source", f.sources.id), title: f.sources.title, url: f.sources.url } : null,
          entity: f.company_id ? { ref: ref("company", f.company_id) } : f.establishment_id ? { ref: ref("establishment", f.establishment_id) } : f.asset_id ? { ref: ref("asset", f.asset_id) } : null,
          visit: f.visit_id ? { ref: ref("visit", f.visit_id) } : null,
          created_at: f.created_at,
        }))),
      };
    }
    case "list_opportunities": {
      let q = db.from("opportunities").select("id, title, thesis, route, status, stage, next_action, created_at, opportunity_findings(count)").order("created_at", { ascending: false }).limit(50);
      if (typeof a.status === "string" && a.status !== "todas") q = q.eq("status", a.status);
      const { data } = await q;
      return {
        content: track(ctx, (data ?? []).map((o) => ({
          ref: ref("opportunity", o.id),
          title: o.title,
          thesis: clip(o.thesis, 600),
          route: o.route,
          status: opportunityStatus.label(o.status),
          stage: o.stage ? dealflowStage.label(o.stage) : null,
          next_action: o.next_action,
          supporting_findings: o.opportunity_findings[0]?.count ?? 0,
        }))),
      };
    }
    case "list_visits": {
      const days = typeof a.since_days === "number" ? a.since_days : 30;
      const { data } = await db
        .from("visits")
        .select("id, visited_at, interlocutor_name, consent_status, notes, is_demo, campaign_targets(companies(id, trade_name, legal_name), establishments(id, name), assets(id, title))")
        .gte("visited_at", new Date(Date.now() - days * 86_400_000).toISOString())
        .order("visited_at", { ascending: false })
        .limit(30);
      return {
        content: track(ctx, (data ?? []).map((v) => {
          const t = v.campaign_targets;
          return {
            ref: ref("visit", v.id),
            visited_at: v.visited_at,
            place: t?.establishments ? { ref: ref("establishment", t.establishments.id), name: t.establishments.name } : t?.assets ? { ref: ref("asset", t.assets.id), name: t.assets.title } : t?.companies ? { ref: ref("company", t.companies.id), name: companyName(t.companies) } : null,
            interlocutor: v.interlocutor_name,
            demo: v.is_demo,
            notes_excerpt: clip(v.notes, 600),
          };
        })),
      };
    }
    case "list_decisions": {
      let q = db.from("decisions").select("id, question, status, decision_note, due_on, created_at, decided_at, opportunity_id").order("created_at", { ascending: false }).limit(30);
      if (typeof a.status === "string" && a.status !== "todas") q = q.eq("status", a.status);
      const { data } = await q;
      return {
        content: track(ctx, (data ?? []).map((d) => ({
          ref: ref("decision", d.id),
          question: d.question,
          status: d.status,
          note: d.decision_note,
          due_on: d.due_on,
          opportunity: d.opportunity_id ? { ref: ref("opportunity", d.opportunity_id) } : null,
        }))),
      };
    }
    case "list_news": {
      let q = db.from("news_articles").select("id, title, source_name, published_at, url, finding_id").order("published_at", { ascending: false, nullsFirst: false }).limit(typeof a.limit === "number" ? Math.min(a.limit, 40) : 15);
      if (typeof a.contains === "string" && a.contains.trim()) q = q.ilike("title", `%${a.contains.trim().replace(/[%_\\]/g, "\\$&")}%`);
      const { data } = await q;
      return {
        content: track(ctx, (data ?? []).map((n) => ({
          ref: ref("news", n.id),
          title: n.title,
          source: n.source_name,
          published_at: n.published_at,
          url: n.url,
          already_finding: n.finding_id ? { ref: ref("finding", n.finding_id) } : null,
        }))),
      };
    }
    case "propose_action": {
      const parsed = ProposeActionInput.safeParse(a);
      if (!parsed.success) return { content: `Borrador inválido: ${parsed.error.issues.map((i) => i.message).join("; ")}`, isError: true };
      const unknownRefs = [parsed.data.source_ref, parsed.data.entity_ref, parsed.data.opportunity_ref, parsed.data.finding_ref, parsed.data.evidence_ref, parsed.data.contact_ref, parsed.data.assignee_ref, ...parsed.data.evidence_refs]
        .filter((r): r is string => !!r)
        .filter((r) => !ctx.seenRefs.has(r));
      if (unknownRefs.length) {
        return { content: `Estas referencias no salieron de ninguna consulta: ${unknownRefs.join(", ")}. Consultalas antes de proponer.`, isError: true };
      }
      const id = await ctx.saveDraft(parsed.data);
      return { content: `Borrador registrado (${id}). Queda pendiente de aprobación humana; no se ejecutó nada.` };
    }
    default:
      if (KNOWLEDGE_TOOL_NAMES.has(name)) return runKnowledgeTool(name, a, ctx);
      return { content: `Herramienta desconocida: ${name}`, isError: true };
  }
}

async function getRecord(ctx: ToolContext, type: string, id: string): Promise<{ content: string; isError?: boolean }> {
  const { db } = ctx;
  const notFound = { content: "No encontrado o sin acceso", isError: true };
  const claimsAndFindings = async (fk: "company_id" | "establishment_id" | "asset_id") => {
    const [{ data: claims }, { data: findings }, { data: targets }, { data: contacts }] = await Promise.all([
      db.from("evidence").select("id, statement, quote, evidence_type, origin_kind, verification_status, observed_at, revalidate_after, next_verification_step, sources(id, title, url)").eq(fk, id).limit(40),
      db.from("findings").select("id, kind, statement, verification_status, review_status").eq(fk, id).limit(30),
      db.from("campaign_targets").select("id, status, next_action, campaigns(id, name), visits(id, visited_at, notes)").eq(fk, id),
      db.from("contact_links").select("relation, contacts(id, full_name, role_title, contact_permission, verification_status)").eq(fk, id),
    ]);
    return {
      evidence: (claims ?? []).map((c) => ({ statement: c.statement, quote: c.quote, type: c.evidence_type, origin: c.origin_kind, verification: c.verification_status, observed_at: c.observed_at, revalidate_after: c.revalidate_after, next_step: c.next_verification_step, source: c.sources ? { ref: ref("source", c.sources.id), title: c.sources.title, url: c.sources.url } : null })),
      findings: (findings ?? []).map((f) => ({ ref: ref("finding", f.id), kind: f.kind, statement: f.statement, verification: f.verification_status, review: f.review_status })),
      campaigns: (targets ?? []).map((t) => ({
        campaign: t.campaigns ? { ref: ref("campaign", t.campaigns.id), name: t.campaigns.name } : null,
        status: t.status,
        next_action: t.next_action,
        visits: t.visits.map((v) => ({ ref: ref("visit", v.id), visited_at: v.visited_at, notes_excerpt: clip(v.notes, 400) })),
      })),
      contacts: (contacts ?? []).flatMap((l) => (l.contacts ? [{ ref: ref("contact", l.contacts.id), name: l.contacts.full_name, relation: l.relation, role: l.contacts.role_title, may_contact: l.contacts.contact_permission, verification: l.contacts.verification_status }] : [])),
    };
  };
  switch (type) {
    case "company": {
      const { data } = await db.from("companies").select("id, trade_name, legal_name, kind, locality, website, verification_status, is_demo, notes, sources(id, title, url)").eq("id", id).maybeSingle();
      if (!data) return notFound;
      return { content: track(ctx, { ref: ref("company", id), name: companyName(data), ...data, notes: clip(data.notes), ...(await claimsAndFindings("company_id")) }) };
    }
    case "establishment": {
      const { data } = await db.from("establishments").select("id, name, address_text, locality, address_status, verification_status, is_demo, notes, company_id").eq("id", id).maybeSingle();
      if (!data) return notFound;
      return { content: track(ctx, { ref: ref("establishment", id), ...data, notes: clip(data.notes), company: data.company_id ? { ref: ref("company", data.company_id) } : null, ...(await claimsAndFindings("establishment_id")) }) };
    }
    case "asset": {
      const [{ data }, { data: prices }] = await Promise.all([
        db.from("assets").select("id, title, kind, operation, category, address_text, locality, address_status, surface_m2, land_m2, capacity_text, occupancy_declared, owner_text, broker_text, operator_text, sale_reason, economics_note, price_amount, price_currency, price_observed_on, price_source_id, price_status, material_change, first_detected_on, last_checked_on, verification_status, is_demo, notes").eq("id", id).maybeSingle(),
        db.from("asset_prices").select("amount, currency, operation, period, observed_on, source_url, publisher, basis, note, origin").eq("asset_id", id).order("observed_on", { ascending: false, nullsFirst: false }),
      ]);
      if (!data) return notFound;
      return {
        content: track(ctx, {
          ref: ref("asset", id),
          ...data,
          // Historial de precios: cada observación con su fuente. Precios distintos = INCONSISTENTE, nunca una baja calculada.
          price_history: (prices ?? []).map((p) => ({ amount: Number(p.amount), currency: p.currency, operation: p.operation, period: p.period, observed_on: p.observed_on, source: p.source_url ?? p.publisher ?? null, basis: p.basis, note: p.note, origin: p.origin })),
          notes: clip(data.notes),
          price: data.price_amount != null ? { amount: data.price_amount, currency: data.price_currency, observed_on: data.price_observed_on, source: { ref: ref("source", data.price_source_id!) } } : "sin dato publicado",
          ...(await claimsAndFindings("asset_id")),
        }),
      };
    }
    case "contact": {
      const { data } = await db.from("contacts").select("id, full_name, role_title, contact_permission, introduced_by, verification_status, is_demo, notes").eq("id", id).maybeSingle();
      if (!data) return notFound;
      // Datos de contacto (email/teléfono) deliberadamente fuera: minimización.
      return { content: track(ctx, { ref: ref("contact", id), ...data, notes: clip(data.notes) }) };
    }
    case "visit": {
      const { data } = await db.from("visits").select("id, visited_at, interlocutor_name, consent_status, notes, is_demo, target_id").eq("id", id).maybeSingle();
      if (!data) return notFound;
      const { data: findings } = await db.from("findings").select("id, kind, statement, review_status").eq("visit_id", id);
      return { content: track(ctx, { ref: ref("visit", id), ...data, notes: clip(data.notes, 6000), findings: (findings ?? []).map((f) => ({ ref: ref("finding", f.id), ...f })) }) };
    }
    case "finding": {
      const { data } = await db.from("findings").select("id, kind, statement, evidence, analysis, verification_status, review_status, review_note, origin, created_at, sources(id, title, url, published_at)").eq("id", id).maybeSingle();
      if (!data) return notFound;
      return { content: track(ctx, { ref: ref("finding", id), ...data, source: data.sources ? { ref: ref("source", data.sources.id), ...data.sources } : null }) };
    }
    case "opportunity": {
      const { data } = await db.from("opportunities").select("id, title, thesis, route, status, stage, stage_reason, next_action, created_at").eq("id", id).maybeSingle();
      if (!data) return notFound;
      const [{ data: links }, { data: decisions }, { data: tasks }] = await Promise.all([
        db.from("opportunity_findings").select("findings(id, kind, statement, verification_status)").eq("opportunity_id", id),
        db.from("decisions").select("id, question, status, decision_note").eq("opportunity_id", id),
        db.from("tasks").select("id, title, status, due_on").eq("opportunity_id", id),
      ]);
      return {
        content: track(ctx, {
          ref: ref("opportunity", id),
          ...data,
          findings: (links ?? []).flatMap((l) => (l.findings ? [{ ref: ref("finding", l.findings.id), ...l.findings }] : [])),
          decisions: (decisions ?? []).map((d) => ({ ref: ref("decision", d.id), ...d })),
          tasks: (tasks ?? []).map((t) => ({ ref: ref("task", t.id), ...t })),
        }),
      };
    }
    case "decision": {
      const { data } = await db.from("decisions").select("id, question, context, status, decision_note, due_on, opportunity_id").eq("id", id).maybeSingle();
      if (!data) return notFound;
      return { content: track(ctx, { ref: ref("decision", id), ...data }) };
    }
    default:
      return { content: `Tipo no soportado: ${type}`, isError: true };
  }
}
