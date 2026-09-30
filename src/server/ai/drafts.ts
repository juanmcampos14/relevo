import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { findingKind } from "@/domain/catalogs";
import { similarFindings } from "@/domain/capture-proposals";
import { companyName } from "@/server/entities";

// Acciones del asistente: la IA PROPONE; una persona aprueba y el servidor ejecuta con SUS permisos.
// Niveles: leer → navegar → proponer → ejecutar (solo con aprobación). Tipos cerrados: el asistente no
// puede promover oportunidades, fusionar personas, confirmar reuniones, enviar mensajes, tocar la
// economía ni descartar casos; como mucho lo sugiere en texto.

type Db = SupabaseClient<Database>;
const REF = (types: string) => new RegExp(`^(${types}):[0-9a-f-]{36}$`);

export const DRAFT_ACTIONS = ["create_task", "prepare_validation", "link_evidence", "update_next_action", "request_help", "draft_finding", "request_decision"] as const;
export type DraftAction = (typeof DRAFT_ACTIONS)[number];
export const HELP_KINDS = ["contacto", "introduccion", "acceso", "validacion", "aprobacion", "capital", "conocimiento"] as const;

export const ProposeActionInput = z.object({
  action: z.enum(DRAFT_ACTIONS),
  title: z.string().trim().max(300).optional(),
  statement: z.string().trim().max(2000).optional(),
  finding_kind: z.enum(findingKind.values).optional(),
  source_ref: z.string().regex(REF("source")).optional(),
  entity_ref: z.string().regex(REF("company|establishment|asset")).optional(),
  opportunity_ref: z.string().regex(REF("opportunity")).optional(),
  finding_ref: z.string().regex(REF("finding")).optional(),
  evidence_ref: z.string().regex(REF("evidence")).optional(),
  contact_ref: z.string().regex(REF("contact")).optional(),
  stance: z.enum(["supports", "contradicts", "contextual"]).optional(),
  next_action: z.string().trim().max(300).optional(),
  assignee_ref: z.string().regex(REF("member")).optional(),
  help_kind: z.enum(HELP_KINDS).optional(),
  help_target: z.string().trim().max(200).optional(),
  due_on: z.iso.date().optional(),
  rationale: z.string().trim().min(1).max(2000),
  evidence_refs: z.array(z.string()).max(20),
}).superRefine((v, ctx) => {
  const need = (ok: unknown, msg: string) => !ok && ctx.addIssue({ code: "custom", message: msg });
  if (v.action === "create_task" || v.action === "request_decision") need(v.title, "title es obligatorio");
  if (v.action === "prepare_validation") need(v.title && v.finding_ref, "prepare_validation requiere title y finding_ref");
  if (v.action === "draft_finding") need(v.statement && v.source_ref, "draft_finding requiere statement y source_ref");
  if (v.action === "link_evidence") need(v.evidence_ref && v.finding_ref && v.stance, "link_evidence requiere evidence_ref, finding_ref y stance");
  if (v.action === "update_next_action") need(v.entity_ref && v.next_action, "update_next_action requiere entity_ref y next_action");
  if (v.action === "request_help") need(v.assignee_ref && v.help_kind && v.title, "request_help requiere assignee_ref, help_kind y title (qué se pide)");
});
export type ProposeAction = z.infer<typeof ProposeActionInput>;

export type Preview = {
  summary: string;
  changes: { entity: string; field: string; before: string | null; after: string }[];
  why: string;
  evidence_refs: string[];
  duplicate_risk: string[];
  expected: string;
};

const idOf = (ref?: string) => (ref ? ref.split(":")[1] : null);
const fkOf = (ref: string) => ({ company: "company_id", establishment: "establishment_id", asset: "asset_id" })[ref.split(":")[0]] as "company_id" | "establishment_id" | "asset_id";

async function entityName(db: Db, ref?: string): Promise<string> {
  if (!ref) return "—";
  const [t, id] = ref.split(":");
  if (t === "company") { const { data } = await db.from("companies").select("trade_name, legal_name").eq("id", id).maybeSingle(); return data ? companyName(data) : ref; }
  if (t === "establishment") { const { data } = await db.from("establishments").select("name").eq("id", id).maybeSingle(); return data?.name ?? ref; }
  if (t === "asset") { const { data } = await db.from("assets").select("title").eq("id", id).maybeSingle(); return data?.title ?? ref; }
  if (t === "finding") { const { data } = await db.from("findings").select("statement").eq("id", id).maybeSingle(); return data ? `«${data.statement}»` : ref; }
  if (t === "evidence") { const { data } = await db.from("evidence").select("statement").eq("id", id).maybeSingle(); return data ? `«${data.statement}»` : ref; }
  if (t === "member") { const { data } = await db.from("profiles").select("display_name, email").eq("user_id", id).maybeSingle(); return data?.display_name || data?.email || ref; }
  if (t === "opportunity") { const { data } = await db.from("opportunities").select("title").eq("id", id).maybeSingle(); return data?.title ?? ref; }
  return ref;
}

/** Vista previa ANTES de aprobar: qué cambia, sobre qué, por qué, con qué evidencia, riesgo de duplicado y resultado esperado. */
export async function previewDraft(db: Db, p: ProposeAction): Promise<Preview> {
  const why = p.rationale;
  const evidence_refs = p.evidence_refs;
  switch (p.action) {
    case "create_task":
    case "prepare_validation": {
      const { data: open } = await db.from("tasks").select("title").neq("status", "done").limit(500);
      const dup = similarFindings(p.title!, (open ?? []).map((t, i) => ({ id: String(i), statement: t.title })), 0.5).map((x) => `Ya hay una tarea parecida abierta: «${x.statement}»`);
      const about = p.finding_ref ? await entityName(db, p.finding_ref) : p.opportunity_ref ? await entityName(db, p.opportunity_ref) : null;
      return {
        summary: p.action === "prepare_validation" ? `Agendar la validación «${p.title}»` : `Crear la tarea «${p.title}»`,
        changes: [{ entity: about ? `Tarea sobre ${about}` : "Tarea nueva", field: "título", before: null, after: p.title! }, ...(p.due_on ? [{ entity: "Tarea nueva", field: "vence", before: null, after: p.due_on }] : [])],
        why, evidence_refs, duplicate_risk: dup,
        expected: p.action === "prepare_validation" ? "Aparece como validación en la hipótesis y en HOY." : "Aparece en tus próximas acciones.",
      };
    }
    case "link_evidence": {
      const { data: already } = await db.from("finding_evidence").select("stance").eq("finding_id", idOf(p.finding_ref)!).eq("evidence_id", idOf(p.evidence_ref)!).maybeSingle();
      return {
        summary: `Vincular evidencia ${p.stance === "contradicts" ? "EN CONTRA de" : p.stance === "supports" ? "a favor de" : "como contexto de"} la hipótesis`,
        changes: [{ entity: await entityName(db, p.finding_ref), field: "evidencia", before: already ? `ya vinculada (${already.stance})` : null, after: `${await entityName(db, p.evidence_ref)} (${p.stance})` }],
        why, evidence_refs: [p.evidence_ref!, ...evidence_refs], duplicate_risk: already ? ["Esa evidencia ya está vinculada a esta hipótesis."] : [],
        expected: "La hipótesis se vuelve a evaluar con esta evidencia (casos, contraevidencia, faltantes).",
      };
    }
    case "update_next_action": {
      const { data: t } = await db.from("campaign_targets").select("id, next_action, next_action_due").eq(fkOf(p.entity_ref!), idOf(p.entity_ref)!).limit(1).maybeSingle();
      return {
        summary: `Actualizar la próxima acción de ${await entityName(db, p.entity_ref)}`,
        changes: [{ entity: await entityName(db, p.entity_ref), field: "próxima acción", before: t?.next_action ?? null, after: p.next_action! }, ...(p.due_on ? [{ entity: await entityName(db, p.entity_ref), field: "fecha", before: t?.next_action_due ?? null, after: p.due_on }] : [])],
        why, evidence_refs, duplicate_risk: t ? [] : ["No está como objetivo en ninguna misión: no hay próxima acción que actualizar."],
        expected: "Cambia la próxima acción en la misión y en HOY.",
      };
    }
    case "request_help": {
      const { data: open } = await db.from("help_requests").select("ask").eq("assignee_id", idOf(p.assignee_ref)!).in("status", ["abierto", "en_curso"]);
      return {
        summary: `Pedir ${p.help_kind} a ${await entityName(db, p.assignee_ref)}`,
        changes: [{ entity: p.finding_ref ? `Caso ${await entityName(db, p.finding_ref)}` : "Pedido de ayuda", field: p.help_kind!, before: null, after: `${p.title}${p.help_target ? ` · buscamos: ${p.help_target}` : ""}` }],
        why, evidence_refs,
        duplicate_risk: similarFindings(p.title!, (open ?? []).map((h, i) => ({ id: String(i), statement: h.ask })), 0.5).map((x) => `Ya le pidieron algo parecido: «${x.statement}»`),
        expected: "Aparece en su vista (HOY y Vista Ejecutiva) para responder con un resultado.",
      };
    }
    case "draft_finding": {
      const { data: fs } = await db.from("findings").select("id, statement").neq("review_status", "rechazado").limit(300);
      return {
        summary: "Registrar una hipótesis (queda pendiente de revisión humana)",
        changes: [{ entity: "Hipótesis nueva", field: "enunciado", before: null, after: p.statement! }],
        why, evidence_refs: [p.source_ref!, ...evidence_refs],
        duplicate_risk: similarFindings(p.statement!, fs ?? []).map((x) => `Parecida a una existente: «${x.statement}»`),
        expected: "Queda en Hallazgos pendiente de revisión; no es evidencia ni oportunidad.",
      };
    }
    case "request_decision": {
      const { data: open } = await db.from("decisions").select("question").eq("status", "requested");
      return {
        summary: "Pedir una decisión al equipo",
        changes: [{ entity: p.opportunity_ref ? await entityName(db, p.opportunity_ref) : "Decisión nueva", field: "pregunta", before: null, after: p.title! }],
        why, evidence_refs,
        duplicate_risk: similarFindings(p.title!, (open ?? []).map((d, i) => ({ id: String(i), statement: d.question })), 0.5).map((x) => `Ya hay una decisión parecida pendiente: «${x.statement}»`),
        expected: "Aparece como voto pendiente para quienes aprueban decisiones.",
      };
    }
  }
}

/** Ejecuta un borrador aprobado con el cliente de quien aprueba (RLS). Devuelve el estado antes/después. */
export async function executeDraft(
  db: Db,
  ctx: { workspaceId: string; userId: string },
  draftId: string,
  p: ProposeAction,
): Promise<{ resultRef: string | null; error: string | null; before: unknown; after: unknown }> {
  const fail = (error: string) => ({ resultRef: null, error, before: null, after: null });
  switch (p.action) {
    case "create_task":
    case "prepare_validation": {
      const { data, error } = await db
        .from("tasks")
        .upsert(
          {
            workspace_id: ctx.workspaceId,
            title: p.title!,
            description: p.rationale,
            due_on: p.due_on ?? null,
            assignee_id: ctx.userId,
            opportunity_id: idOf(p.opportunity_ref),
            finding_id: idOf(p.finding_ref),
            contact_id: idOf(p.contact_ref),
            kind: p.action === "prepare_validation" ? "Validación" : null,
            idempotency_key: `ai:${draftId}`,
          },
          { onConflict: "workspace_id,idempotency_key" },
        )
        .select("id, title, due_on, kind")
        .single();
      return error ? fail(error.message) : { resultRef: `task:${data.id}`, error: null, before: null, after: data };
    }
    case "link_evidence": {
      const row = { workspace_id: ctx.workspaceId, finding_id: idOf(p.finding_ref)!, evidence_id: idOf(p.evidence_ref)!, stance: p.stance!, note: `Propuesto por RELEVO AI: ${p.rationale}`.slice(0, 500) };
      const { error } = await db.from("finding_evidence").upsert(row, { onConflict: "finding_id,evidence_id", ignoreDuplicates: true });
      return error ? fail(error.message) : { resultRef: p.finding_ref!, error: null, before: null, after: row };
    }
    case "update_next_action": {
      const { data: t } = await db.from("campaign_targets").select("id, next_action, next_action_due").eq(fkOf(p.entity_ref!), idOf(p.entity_ref)!).limit(1).maybeSingle();
      if (!t) return fail("No está como objetivo en ninguna misión.");
      const after = { next_action: p.next_action!, next_action_due: p.due_on ?? t.next_action_due };
      const { error } = await db.from("campaign_targets").update(after).eq("id", t.id);
      return error ? fail(error.message) : { resultRef: p.entity_ref!, error: null, before: { next_action: t.next_action, next_action_due: t.next_action_due }, after };
    }
    case "request_help": {
      const { data, error } = await db
        .from("help_requests")
        .insert({ workspace_id: ctx.workspaceId, finding_id: idOf(p.finding_ref), assignee_id: idOf(p.assignee_ref)!, kind: p.help_kind!, ask: p.title!, target: p.help_target ?? null, due_on: p.due_on ?? null })
        .select("id, kind, ask, target, due_on, status")
        .single();
      return error ? fail(error.message) : { resultRef: p.finding_ref ?? null, error: null, before: null, after: data };
    }
    case "draft_finding": {
      const [k, eid] = (p.entity_ref ?? ":").split(":");
      const { data, error } = await db
        .from("findings")
        .insert({
          workspace_id: ctx.workspaceId,
          source_id: idOf(p.source_ref)!,
          kind: p.finding_kind ?? "observacion",
          statement: p.statement!,
          analysis: p.rationale,
          origin: "ia",
          verification_status: "unverified",
          dedup_key: `ai:${draftId}`,
          ...(k === "company" ? { company_id: eid } : k === "establishment" ? { establishment_id: eid } : k === "asset" ? { asset_id: eid } : {}),
        })
        .select("id, statement, review_status")
        .single();
      if (error && error.code === "23505") return { resultRef: null, error: null, before: null, after: null };
      return error ? fail(error.message) : { resultRef: `finding:${data.id}`, error: null, before: null, after: data };
    }
    case "request_decision": {
      const { data, error } = await db
        .from("decisions")
        .insert({ workspace_id: ctx.workspaceId, question: p.title!, context: p.rationale, opportunity_id: idOf(p.opportunity_ref) })
        .select("id, question, status")
        .single();
      return error ? fail(error.message) : { resultRef: `decision:${data.id}`, error: null, before: null, after: data };
    }
  }
}
