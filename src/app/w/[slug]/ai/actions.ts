"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import type { ActionState } from "@/server/action-result";
import { after } from "next/server";
import { runTurn } from "@/server/ai/turn";
import { ProposeActionInput, executeDraft } from "@/server/ai/drafts";
import { assessFinding } from "@/server/findings/assess";
import { activeMission, applyCorrection } from "@/server/mission/focus";
import { workingMission } from "@/server/mission/current";
import { undoRelationship, type RelationshipEffects } from "@/server/ai/relationships";
import { undoSetAside, type SetAsideEffects } from "@/server/ai/set-aside";
import { undoContactEvent, type EventEffects } from "@/server/ai/contact-events";

export async function sendMessage(slug: string, conversationId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  const text = z.string().trim().min(1).max(4000).safeParse(fd.get("text"));
  if (!text.success) return { errors: { text: "Escribí una pregunta" } };
  const supabase = await createClient();
  const res = await runTurn(supabase, { slug, workspaceId: ctx.workspace.id, workspaceName: ctx.workspace.name, userId: ctx.user.id, conversationId, text: text.data, scope: String(fd.get("scope") ?? "") });
  revalidatePath(`/w/${slug}/ai`);
  if (!res.ok) {
    if (!conversationId && res.conversationId) redirect(`/w/${slug}/ai?c=${res.conversationId}&error=1`);
    return { message: res.message };
  }
  if (!conversationId) redirect(`/w/${slug}/ai?c=${res.conversationId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------------
// Borradores: la IA propone, un humano aprueba y el servidor ejecuta con SUS permisos
// ---------------------------------------------------------------------------------

export async function decideDraft(slug: string, draftId: string, verdict: "aprobar" | "rechazar"): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return;
  const supabase = await createClient();
  const { data: draft } = await supabase.from("ai_action_drafts").select("*").eq("id", draftId).eq("status", "propuesta").maybeSingle();
  if (!draft) return;
  const stamp = { decided_by: ctx.user.id, decided_at: new Date().toISOString() };

  if (verdict === "rechazar") {
    await supabase.from("ai_action_drafts").update({ ...stamp, status: "rechazada" }).eq("id", draftId).eq("status", "propuesta");
    revalidatePath(`/w/${slug}/ai`);
    return;
  }

  const p = ProposeActionInput.safeParse({ ...(draft.payload as object), action: draft.action, rationale: draft.rationale ?? "-", evidence_refs: draft.evidence_refs });
  const exec = p.success ? await executeDraft(supabase, { workspaceId: ctx.workspace.id, userId: ctx.user.id, campaignId: await workingMission(supabase) }, draftId, p.data) : { resultRef: null, error: "Borrador inválido", before: null, after: null };
  const { resultRef, error } = exec;
  // Cambió la evidencia de una hipótesis: se vuelve a evaluar sin hacer esperar.
  if (!error && p.success && p.data.action === "link_evidence" && p.data.finding_ref) {
    const findingId = p.data.finding_ref.split(":")[1];
    after(async () => { await assessFinding(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, findingId }); });
  }
  await supabase
    .from("ai_action_drafts")
    .update({ ...stamp, status: error ? "error" : "ejecutada", result_ref: resultRef, error, before_state: (exec.before ?? null) as never, after_state: (exec.after ?? null) as never })
    .eq("id", draftId);
  revalidatePath(`/w/${slug}`, "layout");
}

/** Deshace una acción que RELEVO aplicó sola ("ya le escribí", "confirmó la reunión"): queda auditada como deshecha. */
export async function undoDraft(slug: string, draftId: string): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return;
  const supabase = await createClient();
  const { data: draft } = await supabase.from("ai_action_drafts").select("id, action, payload, after_state").eq("id", draftId).eq("status", "ejecutada").in("action", ["contact_event", "relationship_change", "set_aside"]).maybeSingle();
  if (!draft?.after_state) return;
  if (draft.action === "set_aside") {
    await undoSetAside(supabase, ctx.workspace.id, draft.after_state as unknown as SetAsideEffects);
    await supabase.from("ai_action_drafts").update({ status: "deshecha", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", draftId);
    revalidatePath(`/w/${slug}`, "layout");
    return;
  }
  if (draft.action === "relationship_change") {
    const contactId = String((draft.payload as { contact_ref?: string }).contact_ref ?? "").split(":")[1];
    await undoRelationship(supabase, contactId, draft.after_state as unknown as RelationshipEffects);
    await supabase.from("ai_action_drafts").update({ status: "deshecha", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", draftId);
    revalidatePath(`/w/${slug}`, "layout");
    return;
  }
  await undoContactEvent(supabase, draft.after_state as unknown as EventEffects);
  const back = (draft.after_state as { focus_resolved?: string[] }).focus_resolved ?? [];
  if (back.length) {
    const mission = await activeMission(supabase);
    if (mission) await applyCorrection(supabase, mission, { kind: "reactivar", ids: back }, ctx.user.id);
  }
  await supabase.from("ai_action_drafts").update({ status: "deshecha", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", draftId);
  revalidatePath(`/w/${slug}`, "layout");
}
