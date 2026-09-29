"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { formToObject, stopStatusSchema, visitPlanSchema, visitSchema, zodFieldErrors } from "@/domain/schemas";

const readOnly: ActionState = { message: "Tu rol es de solo lectura." };
// Etapas CRM previas a una reunión: agendar una visita lleva a "Reunión"; registrarla, a "Diagnóstico".
const PRE_VISIT = ["investigacion", "calificacion", "contacto_pendiente", "contactado"];

async function editor(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  return { ctx, supabase: ctx.canEdit ? await createClient() : null };
}

export async function createPlan(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = visitPlanSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const { data, error } = await supabase
    .from("visit_plans")
    .insert({ ...parsed.data, workspace_id: ctx.workspace.id, owner_id: ctx.user.id })
    .select("id")
    .single();
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/agenda/${data.id}`);
}

export async function addStop(slug: string, planId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const targetId = String(fd.get("target_id") ?? "");
  if (!targetId) return { errors: { target_id: "Elegí un objetivo" } };
  const targetTime = String(fd.get("target_time") ?? "") || null;
  const { data: last } = await supabase
    .from("visit_stops")
    .select("position")
    .eq("plan_id", planId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("visit_stops").insert({
    workspace_id: ctx.workspace.id,
    plan_id: planId,
    target_id: targetId,
    position: (last?.position ?? -1) + 1,
    target_time: targetTime,
  });
  if (error) return { message: error.code === "23505" ? "Ese objetivo ya está en la jornada." : dbErrorMessage(error) };
  // Una visita agendada adelanta el estado del objetivo, nunca lo retrocede.
  await supabase.from("campaign_targets").update({ status: "reunion" }).eq("id", targetId).in("status", PRE_VISIT);
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Parada agregada." };
}

export async function moveStop(slug: string, planId: string, stopId: string, direction: "up" | "down"): Promise<void> {
  const { supabase } = await editor(slug);
  if (!supabase) return;
  const { data: stops } = await supabase.from("visit_stops").select("id, position").eq("plan_id", planId).order("position");
  if (!stops) return;
  const i = stops.findIndex((s) => s.id === stopId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= stops.length) return;
  await supabase.from("visit_stops").update({ position: stops[j].position }).eq("id", stops[i].id);
  await supabase.from("visit_stops").update({ position: stops[i].position }).eq("id", stops[j].id);
  revalidatePath(`/w/${slug}/agenda/${planId}`);
}

export async function removeStop(slug: string, planId: string, stopId: string): Promise<void> {
  const { supabase } = await editor(slug);
  if (!supabase) return;
  // Una parada con visita registrada no se borra (la visita queda, pero perdería su contexto de jornada).
  const { count } = await supabase.from("visits").select("id", { count: "exact", head: true }).eq("stop_id", stopId);
  if (count) return;
  await supabase.from("visit_stops").delete().eq("id", stopId);
  revalidatePath(`/w/${slug}/agenda/${planId}`);
}

export async function setStopStatus(slug: string, planId: string, stopId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const status = stopStatusSchema.safeParse(fd.get("status"));
  if (!status.success) return { message: "Estado inválido" };
  const { error } = await supabase.from("visit_stops").update({ status: status.data }).eq("id", stopId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}/agenda/${planId}`);
  return { ok: true };
}

export async function createVisit(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const parsed = visitSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { errors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  // `datetime-local` llega sin zona: es hora de Argentina (UTC-3, sin horario de verano).
  const visitedAt = new Date(`${v.visited_at.length === 16 ? `${v.visited_at}:00` : v.visited_at}-03:00`).toISOString();
  const { data, error } = await supabase
    .from("visits")
    .insert({ ...v, visited_at: visitedAt, workspace_id: ctx.workspace.id })
    .select("id")
    .single();
  if (error) return { message: dbErrorMessage(error) };
  if (v.stop_id) await supabase.from("visit_stops").update({ status: "realizada" }).eq("id", v.stop_id);
  await supabase
    .from("campaign_targets")
    .update({ status: "diagnostico" })
    .eq("id", v.target_id)
    .in("status", [...PRE_VISIT, "reunion"]);
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/agenda/visita/${data.id}?nueva=1`);
}

export async function updateVisitNotes(slug: string, visitId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { supabase } = await editor(slug);
  if (!supabase) return readOnly;
  const notes = String(fd.get("notes") ?? "").trim();
  if (!notes) return { errors: { notes: "Las notas no pueden quedar vacías" } };
  const { error } = await supabase.from("visits").update({ notes }).eq("id", visitId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Notas guardadas." };
}
