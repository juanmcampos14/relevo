"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { assessFinding } from "@/server/findings/assess";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import type { ActionState } from "@/server/action-result";
import { processCapture } from "@/server/capture/process";
import { acceptGroup, decideProposal } from "@/server/capture/promote";

export async function processCaptureNow(slug: string, captureId: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const res = await processCapture(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, captureId });
  revalidatePath(`/w/${slug}`, "layout");
  return res.ok ? { ok: true, message: res.proposals ? `${res.proposals} propuestas para revisar.` : "No encontré nada para estructurar." } : { message: res.message };
}

const EDITABLE = ["name", "role", "locality", "activity", "statement", "evidence_type", "verification_status", "title", "due", "kind", "rationale", "operation", "address_text", "surface_m2"];

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
  if (link && link !== "nuevo" && link !== original.link_to) edits.link_to = link;
  // Eligió crear uno nuevo aunque la IA lo haya vinculado a uno existente.
  if (link === "nuevo" && original.link_to) edits.link_to = null;
  const supabase = await createClient();
  const group = String(fd.get("group") ?? "");
  if (fd.get("decision") === "todo" && (group === "company" || group === "asset")) {
    const { data: prop } = await supabase.from("proposals").select("capture_id").eq("id", proposalId).single();
    const res = await acceptGroup(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, captureId: prop!.capture_id!, subject: group, subjectEdits: edits });
    revalidatePath(`/w/${slug}`, "layout");
    if (res.affectedFindings.length) {
      const ids = [...new Set(res.affectedFindings)];
      after(async () => {
        for (const findingId of ids) await assessFinding(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, findingId });
      });
    }
    return res.skipped.length
      ? { message: `Se aceptaron ${res.accepted}; ${res.skipped.length} quedaron pendientes: ${[...new Set(res.skipped)].join(" · ")}` }
      : { ok: true, message: `Se aceptaron ${res.accepted} propuestas.` };
  }
  const res = await decideProposal(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, proposalId, decision: { action, edits } });
  revalidatePath(`/w/${slug}`, "layout");
  if (res.ok && res.affectedFindings?.length) {
    // Cambió la evidencia de un finding: su estado (qué sabemos / qué falta) se vuelve a evaluar sin hacer esperar.
    const ids = [...new Set(res.affectedFindings)];
    after(async () => {
      for (const findingId of ids) await assessFinding(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, findingId });
    });
  }
  return res.ok ? { ok: true, message: res.message } : { message: res.message };
}
