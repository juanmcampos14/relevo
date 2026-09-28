"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { commitPendingSources, peekSource } from "@/server/sources";
import { buildBriefing } from "@/server/briefing";
import { entityFkFields, isEntityKind } from "@/server/entities";
import {
  candidateSchema,
  commentSchema,
  decisionRequestSchema,
  findingSchema,
  formToObject,
  reviewSchema,
  stageSchema,
  taskSchema,
  taskStatusSchema,
  verdictSchema,
  zodFieldErrors,
} from "@/domain/schemas";

const readOnly: ActionState = { message: "Tu rol es de solo lectura." };

async function editor(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  return { ctx, supabase: ctx.canEdit ? await createClient() : null };
}

function done(slug: string, message: string): ActionState {
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message };
}

// ---------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------

/** Fuente automática "Visita a X" para hallazgos que salen de las notas de una visita. */
async function visitSource(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, visitId: string) {
  const reference = `visita:${visitId}`;
  const { data: found } = await supabase.from("sources").select("id").eq("reference", reference).maybeSingle();
  if (found) return found.id;
  const { data: visit } = await supabase
    .from("visits")
    .select("visited_at, is_demo, campaign_targets(companies(trade_name, legal_name), establishments(name), assets(title))")
    .eq("id", visitId)
    .single();
  const t = visit?.campaign_targets;
  const name = t?.establishments?.name ?? t?.assets?.title ?? t?.companies?.trade_name ?? t?.companies?.legal_name ?? "objetivo";
  const { data, error } = await supabase
    .from("sources")
    .insert({
      workspace_id: workspaceId,
      kind: "observacion",
      title: `Visita a ${name} (${new Date(visit?.visited_at ?? Date.now()).toLocaleDateString("es-AR")})`,
      reference,
      is_demo: !!visit?.is_demo,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function createFinding(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const ws = ctx.workspace.id;
  const obj = formToObject(fd);
  const useVisit = obj.source_mode === "visit" && typeof obj.visit_id === "string" && obj.visit_id;
  const peek = peekSource(fd);
  if (peek.error) return { errors: { new_source_url: peek.error } };
  obj.source_id = useVisit ? "00000000-0000-4000-8000-000000000001" : peek.value;
  const parsed = findingSchema.safeParse(obj);
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };

  let row = parsed.data;
  if (useVisit) {
    row = { ...row, source_id: await visitSource(supabase, ws, String(obj.visit_id)) };
  } else {
    const c = await commitPendingSources(supabase, ws, fd, row, [{ key: "source_id", prefix: "" }]);
    if (c.error) return { message: c.error };
    row = c.row;
  }
  const { entity, ...fields } = row;
  let entityFields = {};
  if (entity) {
    const [k, id] = entity.split(":");
    if (isEntityKind(k) && id) entityFields = entityFkFields(k, id);
  }
  const dedupKey = String(fd.get("dedup_key") ?? "") || null;
  const { error } = await supabase
    .from("findings")
    .insert({ ...fields, ...entityFields, workspace_id: ws, dedup_key: dedupKey });
  if (error) {
    if (error.code === "23505") return done(slug, "Ese hallazgo ya estaba registrado.");
    return { message: dbErrorMessage(error) };
  }
  return done(slug, "Hallazgo registrado: queda pendiente de revisión.");
}

export async function reviewFinding(slug: string, findingId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = reviewSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase
    .from("findings")
    .update({ review_status: parsed.data.verdict, review_note: parsed.data.review_note })
    .eq("id", findingId)
    .eq("review_status", "pendiente_revision");
  if (error) return { message: dbErrorMessage(error) };
  return done(slug, parsed.data.verdict === "aprobado" ? "Hallazgo aprobado. No crea nada por sí solo." : "Hallazgo rechazado.");
}

export async function reopenFinding(slug: string, findingId: string): Promise<void> {
  const { supabase } = await editor(slug);
  if (!supabase) return;
  await supabase.from("findings").update({ review_status: "pendiente_revision", review_note: null }).eq("id", findingId);
  revalidatePath(`/w/${slug}`, "layout");
}

// ---------------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------------

export async function createTask(
  slug: string,
  links: { findingId?: string; opportunityId?: string; targetId?: string },
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = taskSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase.from("tasks").insert({
    ...parsed.data,
    workspace_id: ctx.workspace.id,
    finding_id: links.findingId ?? null,
    opportunity_id: links.opportunityId ?? null,
    target_id: links.targetId ?? null,
  });
  if (error) {
    // Misma clave de idempotencia: el doble envío no duplica.
    if (error.code === "23505") return done(slug, "La tarea ya estaba creada.");
    return { message: dbErrorMessage(error) };
  }
  return done(slug, "Tarea creada.");
}

export async function setTaskStatus(slug: string, taskId: string, status: string): Promise<void> {
  const { supabase } = await editor(slug);
  const parsed = taskStatusSchema.safeParse(status);
  if (!supabase || !parsed.success) return;
  await supabase.from("tasks").update({ status: parsed.data }).eq("id", taskId);
  revalidatePath(`/w/${slug}`, "layout");
}

// ---------------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------------

export async function proposeCandidate(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = candidateSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { finding_ids, ...row } = parsed.data;
  const ws = ctx.workspace.id;

  const { data: approved } = await supabase.from("findings").select("id, campaign_id").in("id", finding_ids).eq("review_status", "aprobado");
  if (!approved || approved.length !== finding_ids.length) {
    return { message: "Solo se puede proponer una oportunidad desde hallazgos aprobados en revisión." };
  }

  let oppId: string;
  const { data, error } = await supabase
    .from("opportunities")
    .insert({ ...row, workspace_id: ws, campaign_id: approved.find((f) => f.campaign_id)?.campaign_id ?? null })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: existing } = await supabase.from("opportunities").select("id").eq("idempotency_key", row.idempotency_key).single();
    if (!existing) return { message: dbErrorMessage(error) };
    oppId = existing.id;
  } else if (error) {
    return { message: dbErrorMessage(error) };
  } else {
    oppId = data.id;
  }
  const { error: linkError } = await supabase
    .from("opportunity_findings")
    .upsert(finding_ids.map((finding_id) => ({ workspace_id: ws, opportunity_id: oppId, finding_id })), { ignoreDuplicates: true });
  if (linkError) return { message: dbErrorMessage(linkError) };
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/oportunidades/o/${oppId}`);
}

export async function linkFindings(slug: string, oppId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const ids = fd.getAll("finding_ids").map(String).filter(Boolean);
  if (!ids.length) return { errors: { finding_ids: "Elegí al menos uno" } };
  const { error } = await supabase
    .from("opportunity_findings")
    .upsert(ids.map((finding_id) => ({ workspace_id: ctx.workspace.id, opportunity_id: oppId, finding_id })), { ignoreDuplicates: true });
  if (error) return { message: error.message.includes("findings aprobados") ? "Solo se vinculan hallazgos aprobados." : dbErrorMessage(error) };
  return done(slug, "Hallazgos vinculados.");
}

export async function requestApproval(slug: string, oppId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = decisionRequestSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase
    .from("decisions")
    .insert({ ...parsed.data, workspace_id: ctx.workspace.id, opportunity_id: oppId, kind: "aprobar_oportunidad" });
  if (error) return { message: error.code === "23505" ? "Ya hay una solicitud de aprobación pendiente." : dbErrorMessage(error) };
  return done(slug, "Aprobación solicitada. Queda en decisiones pendientes.");
}

export async function decide(slug: string, decisionId: string, kind: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canApprove) return { message: "Tu usuario no tiene la capacidad de aprobar decisiones." };
  const parsed = verdictSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } =
    kind === "aprobar_oportunidad"
      ? await supabase.rpc("decide_opportunity", {
          p_decision: decisionId,
          p_verdict: parsed.data.verdict,
          p_note: parsed.data.decision_note ?? "",
        })
      : await supabase.from("decisions").update({ status: parsed.data.verdict, decision_note: parsed.data.decision_note }).eq("id", decisionId);
  if (error) {
    if (error.message.includes("ya fue tomada")) return { message: "Esa decisión ya fue tomada." };
    if (error.code === "42501") return { message: "Tu usuario no tiene la capacidad de aprobar decisiones." };
    return { message: error.message.includes("finding aprobado") ? "La oportunidad necesita al menos un hallazgo aprobado." : dbErrorMessage(error) };
  }
  return done(slug, "Decisión registrada.");
}

export async function createDecision(slug: string, oppId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = decisionRequestSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase.from("decisions").insert({ ...parsed.data, workspace_id: ctx.workspace.id, opportunity_id: oppId });
  if (error) return { message: dbErrorMessage(error) };
  return done(slug, "Decisión solicitada.");
}

export async function setStage(slug: string, oppId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = stageSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { error } = await supabase.from("opportunities").update(parsed.data).eq("id", oppId).eq("status", "aprobada");
  if (error) return { message: dbErrorMessage(error) };
  return done(slug, "Dealflow actualizado.");
}

// ---------------------------------------------------------------------------------
// Comentarios
// ---------------------------------------------------------------------------------

type CommentTarget = { decision_id?: string; opportunity_id?: string; finding_id?: string; briefing_id?: string };

export async function addComment(slug: string, target: CommentTarget, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  const parsed = commentSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("comments")
    .insert({ ...target, body: parsed.data.body, workspace_id: ctx.workspace.id, author_id: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  return done(slug, "Comentario agregado.");
}

// ---------------------------------------------------------------------------------
// Briefings (armados desde registros; sin IA en P0)
// ---------------------------------------------------------------------------------

export async function generateBriefing(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const scope = fd.get("scope") === "personal" ? "personal" : "conjunto";
  const days = Math.min(Math.max(Number(fd.get("days")) || 7, 1), 60);
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 86_400_000);
  const content = await buildBriefing(supabase, {
    slug,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    scope,
    periodStart,
    periodEnd,
  });
  const { data, error } = await supabase
    .from("briefings")
    .insert({
      workspace_id: ctx.workspace.id,
      scope,
      audience_user_id: scope === "personal" ? ctx.user.id : null,
      title: scope === "personal" ? `Mi briefing · últimos ${days} días` : `Briefing conjunto · últimos ${days} días`,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      content,
    })
    .select("id")
    .single();
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/oportunidades/briefings/${data.id}`);
}

export async function publishBriefing(slug: string, briefingId: string): Promise<void> {
  const { supabase } = await editor(slug);
  if (!supabase) return;
  await supabase
    .from("briefings")
    .update({ status: "publicado_en_app", published_at: new Date().toISOString() })
    .eq("id", briefingId)
    .eq("status", "borrador");
  revalidatePath(`/w/${slug}`, "layout");
}
