"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { WorkbookError, parseCrmWorkbook } from "@/server/crm-import/parse";
import { stageImport } from "@/server/crm-import/stage";
import { applyBatch, pendingChoices, type Resolution } from "@/server/crm-import/apply";
import { decideRow } from "@/server/crm-import/review";
import type { Issue } from "@/domain/crm-import/map";
import type { FieldChange, FieldConflict } from "@/domain/crm-import/diff";

const MAX_BYTES = 4 * 1024 * 1024;

/** Sube el .xlsx exportado del CRM y arma un lote para revisar. No escribe en RELEVO todavía. */
export async function uploadCrm(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errors: { file: "Elegí el archivo .xlsx exportado del Sheet." } };
  if (!/\.xlsx$/i.test(file.name)) return { errors: { file: "Tiene que ser .xlsx (Archivo → Descargar → Microsoft Excel)." } };
  if (file.size > MAX_BYTES) return { errors: { file: "El archivo supera 4 MB." } };
  const buffer = await file.arrayBuffer();
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", buffer)).toString("hex");
  const only = String(fd.get("ids") ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  let batchId: string;
  try {
    const parsed = await parseCrmWorkbook(buffer);
    const supabase = await createClient();
    batchId = await stageImport(supabase, ctx.workspace.id, parsed, { fileName: file.name, sha256, onlyCompanies: only });
  } catch (e) {
    if (e instanceof WorkbookError) return { message: e.message };
    return { message: dbErrorMessage(e as { code?: string }) };
  }
  redirect(`/w/${slug}/integraciones/importar/${batchId}`);
}

function resolutionFrom(fd: FormData): Resolution {
  const issues: Record<string, "aplicar" | "ignorar"> = {};
  const fields: Record<string, "sheet" | "relevo"> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("issue-") && (v === "aplicar" || v === "ignorar")) issues[k.slice(6)] = v;
    if (k.startsWith("field-") && (v === "sheet" || v === "relevo")) fields[k.slice(6)] = v;
  }
  return { issues, fields };
}

export async function decideImportRow(slug: string, rowId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const decision = fd.get("decision") === "rechazada" ? "rechazada" : "aprobada";
  const supabase = await createClient();
  const res = await decideRow(supabase, rowId, decision, resolutionFrom(fd), ctx.user.id);
  if (res.error) return { message: res.error };
  revalidatePath(`/w/${slug}/integraciones/importar`, "layout");
  return { ok: true, message: decision === "aprobada" ? "Fila aprobada: se escribe al aplicar el lote." : "Fila rechazada." };
}

/** Aprueba de una vez las filas que no tienen nada que decidir (ni propuestas ni conflictos). */
export async function approveClean(slug: string, batchId: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data: rows } = await supabase.from("import_rows").select("id, issues, conflicts").eq("batch_id", batchId).eq("decision", "pendiente");
  let n = 0;
  for (const r of rows ?? []) {
    const view = { issues: r.issues as unknown as Issue[], conflicts: r.conflicts as unknown as { updates?: FieldChange[]; conflicts?: FieldConflict[] }, resolution: {} };
    if (pendingChoices(view).length) continue;
    const res = await decideRow(supabase, r.id, "aprobada", {}, ctx.user.id);
    if (!res.error) n++;
  }
  revalidatePath(`/w/${slug}/integraciones/importar`, "layout");
  return { ok: true, message: n ? `${n} filas aprobadas.` : "No hay filas sin decisiones pendientes." };
}

export async function applyImport(slug: string, batchId: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const res = await applyBatch(supabase, ctx.workspace.id, batchId);
  revalidatePath(`/w/${slug}`, "layout");
  if (res.errors.length) {
    return { message: `Se aplicaron ${res.applied} filas; ${res.errors.length} con error: ${res.errors.map((e) => `${e.external_id} (${e.message})`).join(" · ")}` };
  }
  return { ok: true, message: res.applied ? `Listo: ${res.applied} filas escritas en RELEVO.` : "No había filas aprobadas por aplicar." };
}

export async function discardImport(slug: string, batchId: string): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return;
  const supabase = await createClient();
  await supabase.from("import_batches").update({ status: "descartado", closed_at: new Date().toISOString() }).eq("id", batchId).eq("status", "en_revision");
  revalidatePath(`/w/${slug}/integraciones`, "layout");
}
