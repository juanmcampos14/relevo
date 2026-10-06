"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { assessFinding } from "@/server/findings/assess";
import { promotionWarning } from "@/domain/promotion";

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

export type PromoteState = ActionState & { confirm?: string };

/**
 * Idea → hipótesis → finding → caso: promoción humana, registrada en la historia de la hipótesis. Sin
 * evidencia suficiente no se bloquea, pero se avisa y se pide confirmación (caso H-VA-02); si se promueve
 * igual, la historia guarda quién, cuándo, de qué a qué y el motivo.
 */
export async function promoteMaturity(slug: string, findingId: string, to: "hipotesis" | "finding" | "caso", _: PromoteState, fd: FormData): Promise<PromoteState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data: f } = await supabase.from("findings").select("maturity").eq("id", findingId).single();
  if (!f || f.maturity === to) return { message: "Ya estaba así." };
  const confirmed = fd.get("confirm") === "1";
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  if (!confirmed) {
    const [{ count: evidence }, { data: last }] = await Promise.all([
      supabase.from("finding_evidence").select("evidence_id", { count: "exact", head: true }).eq("finding_id", findingId),
      supabase.from("finding_assessments").select("supports, independent_cases, gaps").eq("finding_id", findingId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const warning = promotionWarning(to, { evidence: evidence ?? 0, supports: last?.supports ?? 0, independentCases: last?.independent_cases ?? 0, gaps: last?.gaps ?? [] });
    if (warning) return { confirm: warning };
  }
  const { error } = await supabase.from("findings").update({ maturity: to }).eq("id", findingId);
  if (error) return { message: dbErrorMessage(error) };
  await supabase.from("finding_revisions").insert({ workspace_id: ctx.workspace.id, finding_id: findingId, kind: "madurez", previous_value: f.maturity, new_value: to, reason: confirmed ? `Promovida sin evidencia suficiente${reason ? `: ${reason}` : " (sin motivo)"}` : reason || "Promoción" });
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: to === "caso" ? "Ahora es un caso en estudio." : to === "finding" ? "Promovido a finding." : "Ahora es una hipótesis a validar." };
}

const HELP_KINDS = ["contacto", "introduccion", "acceso", "validacion", "aprobacion", "capital", "conocimiento"] as const;

/** Pedido de ayuda concreto sobre un caso: a quién, qué tipo de ayuda, a quién se busca y para cuándo. */
export async function requestHelp(slug: string, findingId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const assignee = String(fd.get("assignee") ?? "");
  const ask = String(fd.get("ask") ?? "").trim();
  const kind = String(fd.get("kind") ?? "");
  if (!assignee || !ask || !(HELP_KINDS as readonly string[]).includes(kind)) return { message: "Elegí a quién, qué tipo de ayuda y escribí qué necesitás concretamente." };
  const supabase = await createClient();
  const { error } = await supabase.from("help_requests").insert({
    workspace_id: ctx.workspace.id,
    finding_id: findingId,
    assignee_id: assignee,
    kind,
    ask,
    target: String(fd.get("target") ?? "").trim() || null,
    due_on: String(fd.get("due_on") ?? "") || null,
  });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Pedido de ayuda enviado: aparece en su vista." };
}

/** Responder un pedido de ayuda: en curso, resuelto (con resultado) o cancelado. */
export async function answerHelp(slug: string, helpId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const status = String(fd.get("status") ?? "");
  const result = String(fd.get("result") ?? "").trim();
  if (!["en_curso", "resuelto", "cancelado"].includes(status)) return { message: "Elegí el estado." };
  if (status === "resuelto" && !result) return { errors: { result: "Contá el resultado (contacto, introducción, dato obtenido…)." } };
  const supabase = await createClient();
  const { error } = await supabase.from("help_requests").update({ status, result: result || null, updated_at: new Date().toISOString() }).eq("id", helpId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: status === "resuelto" ? "Resuelto: el resultado queda en el caso." : "Actualizado." };
}

const CASE_STATUS = ["activo", "pausado", "cerrado", "descartado"] as const;
const MATURITIES = ["idea", "hipotesis", "finding", "caso"] as const;

/**
 * Cambiar el estado del caso (pausar, cerrar, descartar, reactivar) o retroceder su madurez: siempre con
 * motivo; queda en la historia con quién y cuándo. Nada se borra.
 */
export async function changeCaseState(slug: string, findingId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { errors: { reason: "Escribí el motivo (queda en la historia)." } };
  const status = String(fd.get("case_status") ?? "");
  const maturity = String(fd.get("maturity") ?? "");
  const supabase = await createClient();
  const { data: f } = await supabase.from("findings").select("maturity, case_status").eq("id", findingId).single();
  if (!f) return { message: "No encontrado." };
  const changes: { kind: "estado" | "madurez"; previous_value: string; new_value: string }[] = [];
  if ((CASE_STATUS as readonly string[]).includes(status) && status !== f.case_status) changes.push({ kind: "estado", previous_value: f.case_status, new_value: status });
  if ((MATURITIES as readonly string[]).includes(maturity) && maturity !== f.maturity) changes.push({ kind: "madurez", previous_value: f.maturity, new_value: maturity });
  if (!changes.length) return { message: "No hay cambios." };
  const patch: { case_status?: string; maturity?: string } = {};
  for (const c of changes) patch[c.kind === "estado" ? "case_status" : "maturity"] = c.new_value;
  const { error } = await supabase.from("findings").update(patch).eq("id", findingId);
  if (error) return { message: dbErrorMessage(error) };
  await supabase.from("finding_revisions").insert(changes.map((c) => ({ workspace_id: ctx.workspace.id, finding_id: findingId, ...c, reason })));
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Cambio registrado con su motivo." };
}
