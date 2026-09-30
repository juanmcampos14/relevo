"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { assessFinding } from "@/server/findings/assess";

export async function assessFindingNow(slug: string, findingId: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const res = await assessFinding(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, findingId });
  revalidatePath(`/w/${slug}`, "layout");
  return res.ok ? { ok: true, message: res.proposals ? `Estado actualizado: ${res.proposals} validaciones propuestas.` : "Estado actualizado." } : { message: res.message };
}

/** Vincular evidencia ya registrada a un finding (p. ej. el segundo caso), a favor, en contra o como contexto. */
export async function linkEvidence(slug: string, findingId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const evidenceId = String(fd.get("evidence_id") ?? "");
  const stance = String(fd.get("stance") ?? "");
  if (!evidenceId) return { errors: { evidence_id: "Elegí la evidencia" } };
  if (!["supports", "contradicts", "contextual"].includes(stance)) return { errors: { stance: "Elegí si está a favor, en contra o es contexto" } };
  const supabase = await createClient();
  const { error } = await supabase.from("finding_evidence").insert({
    workspace_id: ctx.workspace.id,
    finding_id: findingId,
    evidence_id: evidenceId,
    stance: stance as "supports" | "contradicts" | "contextual",
    note: String(fd.get("note") ?? "").trim() || null,
  });
  if (error) return { message: error.code === "23505" ? "Esa evidencia ya está vinculada." : dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  after(async () => {
    await assessFinding(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, findingId });
  });
  return { ok: true, message: "Evidencia vinculada. El estado se actualiza en unos segundos." };
}

/** Idea → hipótesis → finding: promoción humana, registrada en la historia de la hipótesis. */
export async function promoteMaturity(slug: string, findingId: string, to: "hipotesis" | "finding"): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data: f } = await supabase.from("findings").select("maturity").eq("id", findingId).single();
  if (!f || f.maturity === to) return { message: "Ya estaba así." };
  const { error } = await supabase.from("findings").update({ maturity: to }).eq("id", findingId);
  if (error) return { message: dbErrorMessage(error) };
  await supabase.from("finding_revisions").insert({ workspace_id: ctx.workspace.id, finding_id: findingId, kind: "madurez", previous_value: f.maturity, new_value: to });
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: to === "finding" ? "Promovido a finding." : "Ahora es una hipótesis a validar." };
}
