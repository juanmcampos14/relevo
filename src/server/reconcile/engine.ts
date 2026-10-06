import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { Card, CAPACITY_VARS, type CardSection, type PartyRole, type Section } from "@/domain/candidate";
import { placeSignal, type KnownEvent } from "@/domain/material";
import { bestMatch, candidateImpact, type CandidateImpact } from "@/domain/reconcile";
import { addCriterion, type WatchConfig } from "@/server/mission/watch";
import { deepCall } from "@/server/mission/deep";
import { setCardSection } from "@/server/opportunities/candidate";

// Una fuente nueva (Radar, un documento, una captura) no se importa: se reconcilia. Para cada hecho:
// identificar entidades contra el Brain (sin duplicar), decidir si es un hecho conocido (fuente más) o uno
// nuevo, si es material, qué hipótesis y candidatos toca y qué cambia de lo que creíamos; triage
// (IMPORTA / SEGUIR / NEXT / DESCARTAR) y, si cambia algo, una próxima acción (la tarea canónica).
// Brain primero: nada se promueve a oportunidad ni se descarta solo.

type Db = SupabaseClient<Database>;
export type Triage = "importa" | "seguir" | "next" | "descartar";
const STATUS: Record<Triage, "incorporada" | "seguida" | "procesada" | "descartada"> = { importa: "incorporada", seguir: "seguida", next: "procesada", descartar: "descartada" };

export type FactEntity = { kind: "empresa" | "persona" | "activo"; name: string; role?: PartyRole | null };
export type FactValue = { variable: string; value: string; unit?: string | null; about?: string | null };
export type Fact = {
  key: string;
  statement: string;
  summary?: string | null;
  happened_on?: string | null;
  source_url?: string | null;
  basis: "hecho" | "declaracion" | "inferencia";
  section?: "general" | "anelo" | "empresas" | "activos";
  signal_type?: string;
  entities: FactEntity[];
  values: FactValue[];
  asset_ids?: string[];
};
export type Judgement = { same_as: string | null; material: boolean; triage: Triage; why: string; finding_ids: string[]; candidate_ids: string[]; next_action: string | null; watch: string | null };

export type Outcome = {
  key: string;
  found: string;
  reconciledAgainst: string[];
  created: string[];
  updated: string[];
  sourceAdded: string | null;
  contradiction: string | null;
  impact: (CandidateImpact & { candidate: string })[];
  notCreated: string[];
  review: string[];
  triage: Triage;
  material: boolean;
  why: string;
  signalId: string | null;
  taskIds: string[];
  action: "crear" | "actualizar" | "sin_cambios" | "conflicto" | "rechazar";
};

export type Ctx = { workspaceId: string; missionId: string; origin: "radar_sheet" | "captura" | "vigilancia" | "brief"; sourceLabel: string; externalRef?: boolean; dryRun?: boolean };

// ---------------------------------------------------------------------------------------------------
// Juicio: una llamada por lote. Lo determinístico (mismo hecho, materialidad) es la red; el modelo
// entiende el contexto de la misión (lo que ya sabemos, lo que se sacó del foco, los candidatos).

const JudgeSchema = z.object({
  items: z.array(z.object({
    key: z.string(),
    same_as: z.string().describe("Si cuenta un hecho que ya está en hechos_conocidos (aunque sea otro medio u otras palabras), su ref 'hecho:…'; si no, ''."),
    material: z.boolean().describe("true si cambia una hipótesis, una prioridad, la agenda, un candidato o una próxima acción. Contexto general = false. Lo que la misión sacó del foco no es material salvo que cambie eso."),
    triage: z.enum(["importa", "seguir", "next", "descartar"]).describe("importa: material, cambia algo. seguir: no cambia nada hoy pero hay que vigilarlo. next: entendido, no requiere acción. descartar: no es relevante para la misión."),
    why: z.string().describe("Por qué, en una oración, en lenguaje humano."),
    finding_refs: z.array(z.string()).describe("'finding:…' de la misión que toca (solo si la conexión es clara; una señal sin hipótesis está bien)."),
    candidate_refs: z.array(z.string()).describe("'opportunity:…' de candidatos cuya ficha cambia con este dato."),
    next_action: z.string().describe("Si importa: la acción concreta que propondrías (verificar precio, visitar, llamar a X, confirmar capacidad…); si no, ''."),
    watch: z.string().describe("Si es 'seguir': qué vigilar, en una línea; si no, ''."),
  })),
});

export async function judgeFacts(db: Db, ctx: Ctx, facts: Fact[], known: KnownEvent[], client?: Pick<Anthropic, "beta">): Promise<{ judged: Map<string, Judgement>; costUsd: number }> {
  if (!facts.length) return { judged: new Map(), costUsd: 0 };
  const [{ data: findings }, { data: opps }, { data: mission }] = await Promise.all([
    db.from("findings").select("id, statement").eq("campaign_id", ctx.missionId).eq("case_status", "activo").neq("review_status", "rechazado").limit(60),
    db.from("opportunities").select("id, title, gap, economic_unit, maturity").eq("campaign_id", ctx.missionId).neq("status", "rechazada").limit(30),
    db.from("campaigns").select("name, objective, synthesis").eq("id", ctx.missionId).single(),
  ]);
  const focus = (mission?.synthesis as { focus?: { log?: { item: string; what: string; note?: string | null; by: string | null }[] } } | null)?.focus?.log ?? [];
  const prompt = JSON.stringify({
    mision: { nombre: mission?.name, objetivo: mission?.objective },
    lo_que_la_persona_saco_o_pospuso: focus.filter((l) => l.by).slice(0, 20).map((l) => `«${l.item}» — ${l.what}${l.note ? ` (${l.note})` : ""}`),
    hipotesis: (findings ?? []).map((f) => ({ ref: `finding:${f.id}`, enunciado: f.statement })),
    candidatos: (opps ?? []).map((o) => ({ ref: `opportunity:${o.id}`, titulo: o.title, brecha: o.gap, unidad: o.economic_unit, madurez: o.maturity })),
    hechos_conocidos: known.slice(-80).map((k) => ({ ref: `hecho:${k.id}`, hecho: k.headline, desde: k.happened_on })),
    fuente: ctx.sourceLabel,
    items: facts.map((f) => ({ key: f.key, hecho: f.statement, detalle: f.summary ?? null, fecha: f.happened_on ?? null, entidades: f.entities.map((e) => `${e.kind}: ${e.name}`), datos: f.values })),
  });
  const r = await deepCall(db, {
    workspaceId: ctx.workspaceId, promptVersion: "reconciliar-v1", effort: "low", schema: JudgeSchema, client, prompt,
    system: `Sos RELEVO reconciliando información nueva contra lo que la misión ya sabe. No importás: entendés qué cambia. Artículo ≠ hecho: si el hecho ya está en hechos_conocidos, es una fuente más (same_as). Una publicación u oferta no es una oportunidad validada. Brain primero: no promuevas nada. Relacioná solo cuando la conexión sea clara; un hecho sin hipótesis está bien. Español rioplatense, corto.`,
  });
  const judged = new Map<string, Judgement>();
  if (!r.ok) return { judged, costUsd: 0 };
  const ids = (refs: string[], type: string, allowed: Set<string>) => refs.filter((x) => x.startsWith(`${type}:`)).map((x) => x.slice(type.length + 1)).filter((id) => allowed.has(id));
  const fset = new Set((findings ?? []).map((f) => f.id));
  const oset = new Set((opps ?? []).map((o) => o.id));
  const kset = new Set(known.map((k) => k.id));
  for (const it of r.value.items) {
    const same = it.same_as.startsWith("hecho:") ? it.same_as.slice(6) : null;
    judged.set(it.key, { same_as: same && kset.has(same) ? same : null, material: it.material, triage: it.triage, why: it.why, finding_ids: ids(it.finding_refs, "finding", fset), candidate_ids: ids(it.candidate_refs, "opportunity", oset), next_action: it.next_action.trim() || null, watch: it.watch.trim() || null });
  }
  return { judged, costUsd: r.costUsd };
}

// ---------------------------------------------------------------------------------------------------

type Pool = { companies: { id: string; names: string[] }[]; contacts: { id: string; names: string[] }[] };
export async function entityPool(db: Db): Promise<Pool> {
  const [{ data: cs }, { data: ps }] = await Promise.all([
    db.from("companies").select("id, trade_name, legal_name").eq("is_demo", false).limit(3000),
    db.from("contacts").select("id, full_name").limit(5000),
  ]);
  return {
    companies: (cs ?? []).map((c) => ({ id: c.id, names: [c.trade_name, c.legal_name].filter((n): n is string => !!n) })),
    contacts: (ps ?? []).map((p) => ({ id: p.id, names: [p.full_name] })),
  };
}

const BASIS = { hecho: "observado", declaracion: "declarado", inferencia: "estimado" } as const;

/** Reconcilia un hecho juzgado contra el Brain y devuelve qué hizo (y qué no). */
export async function reconcileFact(db: Db, ctx: Ctx, fact: Fact, j: Judgement, known: KnownEvent[], pool: Pool): Promise<Outcome> {
  const out: Outcome = { key: fact.key, found: fact.statement, reconciledAgainst: [], created: [], updated: [], sourceAdded: null, contradiction: null, impact: [], notCreated: [], review: [], triage: j.triage, material: j.material, why: j.why, signalId: null, taskIds: [], action: "crear" };
  const w = !ctx.dryRun;

  // 1. Entidades: misma → se vincula; posible → se pregunta (nunca se une solo); nueva → se crea solo si importa.
  const companyIds: string[] = [];
  const byName = new Map<string, string>();
  for (const e of fact.entities.filter((x) => x.kind !== "activo")) {
    const m = bestMatch(e.name, e.kind === "empresa" ? pool.companies : pool.contacts);
    if (m?.kind === "misma") {
      out.reconciledAgainst.push(`${e.kind} ${m.item.names[0]}`);
      byName.set(e.name, m.item.id);
      if (e.kind === "empresa") companyIds.push(m.item.id);
      continue;
    }
    if (m?.kind === "posible") {
      out.review.push(`¿${e.name} es ${m.item.names[0]}?`);
      if (w) await db.from("brief_candidates").insert({ workspace_id: ctx.workspaceId, brief_id: null, campaign_id: ctx.missionId, kind: e.kind, name: e.name.slice(0, 200), detail: fact.statement.slice(0, 600), source_url: fact.source_url ?? null, question: `¿${e.name} es la misma que ${m.item.names[0]}?`, maybe_ref: `${e.kind === "empresa" ? "company" : "contact"}:${m.item.id}` });
      continue;
    }
    if (!j.material) { out.notCreated.push(`${e.kind} ${e.name} (no cambia nada todavía)`); continue; }
    out.created.push(`${e.kind} ${e.name}`);
    if (!w) continue;
    if (e.kind === "empresa") {
      const { data: c } = await db.from("companies").insert({ workspace_id: ctx.workspaceId, origin_campaign_id: ctx.missionId, trade_name: e.name.slice(0, 200), notes: `${fact.statement} — ${ctx.sourceLabel} (sin verificar).`, verification_status: "unverified" }).select("id").single();
      if (c) { companyIds.push(c.id); byName.set(e.name, c.id); pool.companies.push({ id: c.id, names: [e.name] }); await db.from("campaign_targets").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.missionId, company_id: c.id }); }
    } else {
      const { data: p } = await db.from("contacts").insert({ workspace_id: ctx.workspaceId, origin_campaign_id: ctx.missionId, full_name: e.name.slice(0, 200), notes: `${fact.statement} — ${ctx.sourceLabel} (sin verificar).`, verification_status: "unverified" }).select("id").single();
      if (p) { byName.set(e.name, p.id); pool.contacts.push({ id: p.id, names: [e.name] }); }
    }
  }

  // 2. ¿Hecho conocido o nuevo? Artículo ≠ hecho.
  const place = placeSignal({ headline: fact.statement, summary: fact.summary, happened_on: fact.happened_on, company_ids: companyIds, asset_ids: fact.asset_ids ?? [], change: "nuevo", relevance: j.material ? "alta" : "media" }, known, { sameAs: j.same_as });
  const material = place.kind === "misma" ? false : j.material && place.material !== false;
  out.material = material;
  if (place.kind === "misma") { out.action = "sin_cambios"; out.sourceAdded = `${fact.source_url ?? ctx.sourceLabel} como fuente de un hecho que ya conocíamos`; out.reconciledAgainst.push(`hecho ${known.find((k) => k.id === place.eventId)?.headline ?? place.eventId}`); }
  if (place.kind === "actualiza") { out.action = "actualizar"; out.updated.push(`hecho conocido, con dato nuevo (${place.novel.join(", ")})`); out.reconciledAgainst.push(`hecho ${known.find((k) => k.id === place.eventId)?.headline ?? place.eventId}`); }
  const triage: Triage = place.kind === "misma" && j.triage === "importa" ? "next" : j.triage;
  out.triage = triage;
  if (w) {
    const { data: s, error } = await db.from("brief_signals").insert({
      workspace_id: ctx.workspaceId, brief_id: null, origin: ctx.origin, external_ref: ctx.externalRef ? fact.key : null, position: 0,
      headline: fact.statement.slice(0, 400), summary: fact.summary ?? null, happened_on: fact.happened_on ?? null, source_url: fact.source_url && /^https?:\/\//.test(fact.source_url) ? fact.source_url : null, source_title: ctx.sourceLabel.slice(0, 300),
      basis: fact.basis, signal_type: fact.signal_type ?? "otro", section: fact.section ?? "general", change: place.change, relevance: material ? "alta" : "media",
      campaign_ids: [ctx.missionId], company_ids: companyIds, finding_ids: j.finding_ids, asset_ids: fact.asset_ids ?? [],
      event_id: place.kind === "nueva" ? null : place.eventId, material, status: STATUS[triage], triaged_at: new Date().toISOString(), triage_reason: j.why, suggested_action: j.next_action,
    } as never).select("id").single();
    if (error) throw new Error(`${fact.key}: ${error.message}`);
    out.signalId = (s as { id: string }).id;
    if (place.kind === "nueva") known.push({ id: out.signalId, headline: fact.statement, summary: fact.summary ?? null, happened_on: fact.happened_on ?? null, story_id: null, text: `${fact.statement} ${fact.summary ?? ""}`, company_ids: companyIds, asset_ids: fact.asset_ids ?? [] });
  }
  if (place.kind === "nueva") out.created.push("señal");

  // 3. Impacto sobre candidatos: los que nombró el juicio y los que cuelgan de una entidad reconocida.
  const evidenceId = material && w && (fact.values.length || companyIds.length)
    ? ((await db.from("evidence").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.missionId, statement: fact.statement.slice(0, 2000), evidence_type: fact.basis === "declaracion" ? "declaracion" : "dato", origin_kind: ctx.origin === "captura" ? "field" : ctx.origin === "radar_sheet" ? "crm_import" : "manual", declared_by: ctx.sourceLabel.slice(0, 200), company_id: companyIds[0] ?? null }).select("id").single()).data?.id ?? null)
    : null;
  if (material && fact.values.length) {
    const linked = new Set(j.candidate_ids);
    if (companyIds.length) {
      const [{ data: own }, { data: as }] = await Promise.all([
        db.from("opportunities").select("id").in("company_id", companyIds).neq("status", "rechazada"),
        db.from("opportunity_parties").select("opportunity_id").in("company_id", companyIds),
      ]);
      for (const o of own ?? []) linked.add(o.id);
      for (const p of as ?? []) linked.add(p.opportunity_id);
    }
    for (const oppId of linked) {
      const { data: o } = await db.from("opportunities").select("title, card, economic_unit, company_id").eq("id", oppId).single();
      if (!o) continue;
      const before = Card.parse(o.card ?? {});
      const { data: parties } = await db.from("opportunity_parties").select("role, company_id").eq("opportunity_id", oppId);
      let after = before;
      const bySection = new Map<Section, FactValue[]>();
      for (const v of fact.values) {
        const sec: Section = (CAPACITY_VARS as readonly string[]).includes(v.variable) ? "capacidad" : "economics";
        bySection.set(sec, [...(bySection.get(sec) ?? []), v]);
      }
      // Un dato sobre otra empresa (un competidor que suma capacidad) es evidencia en contra de la brecha propia.
      const aboutId = (a: string) => byName.get(a) ?? (bestMatch(a, pool.companies)?.kind === "misma" ? bestMatch(a, pool.companies)!.item.id : undefined);
      const foreign = (v: FactValue) => !!v.about && !(o.company_id && aboutId(v.about) === o.company_id);
      for (const [sec, vals] of bySection) {
        const ev = evidenceId ? [evidenceId] : [];
        const next: CardSection = { status: before[sec]?.status ?? "creido", summary: before[sec]?.summary ?? null, evidence_ids: vals.some((v) => !foreign(v)) ? ev : [], against_ids: vals.some(foreign) ? ev : [], values: vals.map((v) => ({ variable: v.variable, value: v.value, unit: v.unit ?? null, basis: BASIS[fact.basis], evidence_ids: ev, about: v.about ?? null })) };
        after = w ? await setCardSection(db, oppId, sec, next) : { ...after, [sec]: { ...(after[sec] ?? next), values: [...(after[sec]?.values ?? []), ...next.values], against_ids: [...(after[sec]?.against_ids ?? []), ...next.against_ids], evidence_ids: [...(after[sec]?.evidence_ids ?? []), ...next.evidence_ids] } };
      }
      // Quien suma capacidad o compite queda como parte del candidato (sin duplicar).
      for (const v of fact.values.filter(foreign)) {
        const cid = aboutId(v.about!);
        if (cid && !(parties ?? []).some((p) => p.company_id === cid && p.role === "competidor") && w) await db.from("opportunity_parties").insert({ workspace_id: ctx.workspaceId, opportunity_id: oppId, role: "competidor", company_id: cid, evidence_id: evidenceId });
      }
      const impact = candidateImpact(before, after, (parties ?? []) as { role: PartyRole }[], o.economic_unit, fact.statement);
      out.impact.push({ ...impact, candidate: o.title });
      out.updated.push(`ficha de «${o.title}»`);
      if (impact.weakened.length) { out.contradiction = `${impact.effect} ${impact.weakened.join(" ")}`; out.action = "conflicto"; }
      if (impact.changed && impact.nextQuestion && w) {
        const { data: t } = await db.from("tasks").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.missionId, opportunity_id: oppId, signal_id: out.signalId, title: `Validar «${o.title}»: ${impact.nextQuestion}`.slice(0, 300), kind: "Validación" }).select("id").single();
        if (t) out.taskIds.push(t.id);
      }
    }
  }

  // 4. Salida natural: si importa, una próxima acción; si hay que seguirlo, un pedido de aviso.
  if (triage === "importa" && j.next_action && !out.taskIds.length && w) {
    const { data: t } = await db.from("tasks").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.missionId, signal_id: out.signalId, title: j.next_action.slice(0, 300), kind: "Seguimiento", finding_id: j.finding_ids[0] ?? null }).select("id").single();
    if (t) out.taskIds.push(t.id);
  }
  if (triage === "seguir" && j.watch && w) {
    const { data: m } = await db.from("campaigns").select("watch").eq("id", ctx.missionId).single();
    await db.from("campaigns").update({ watch: addCriterion((m?.watch as WatchConfig | null) ?? null, { text: j.watch }) as unknown as Json }).eq("id", ctx.missionId);
  }
  if (triage === "descartar" && out.action === "crear") out.action = "rechazar";
  return out;
}
