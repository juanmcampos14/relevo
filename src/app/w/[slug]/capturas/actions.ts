"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import type { ActionState } from "@/server/action-result";
import { processCapture } from "@/server/capture/process";
import { decideProposal } from "@/server/capture/promote";

export async function processCaptureNow(slug: string, captureId: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const res = await processCapture(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, captureId });
  revalidatePath(`/w/${slug}`, "layout");
  return res.ok ? { ok: true, message: res.proposals ? `${res.proposals} propuestas para revisar.` : "No encontré nada para estructurar." } : { message: res.message };
}

const EDITABLE = ["name", "role", "locality", "activity", "statement", "evidence_type", "verification_status", "title", "due", "kind", "rationale"];

/** Aceptar (tal cual o editada) o rechazar una propuesta. Los campos del formulario son la edición. */
export async function decideProposalAction(slug: string, proposalId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const action = fd.get("decision") === "rechazar" ? "rechazar" : "aceptar";
  const original = JSON.parse(String(fd.get("original") ?? "{}")) as Record<string, unknown>;
  const edits: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (!fd.has(k)) continue;
    const v = String(fd.get(k) ?? "").trim();
    const value = v === "" ? null : v;
    if ((original[k] ?? null) !== value) edits[k] = value;
  }
  const link = String(fd.get("link_to") ?? "");
  if (link && link !== "nuevo") edits.link_to = link;
  const supabase = await createClient();
  const res = await decideProposal(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, proposalId, decision: { action, edits } });
  revalidatePath(`/w/${slug}`, "layout");
  return res.ok ? { ok: true, message: res.message } : { message: res.message };
}
