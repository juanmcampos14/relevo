"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { WorkbookError, parseCrmWorkbook } from "@/server/crm-import/parse";
import { stageImport } from "@/server/crm-import/stage";
import { applyBatch, type Resolution } from "@/server/crm-import/apply";
import { decideRow } from "@/server/crm-import/review";
import { triageBatch, type TriageRow } from "@/domain/crm-import/triage";
import { readCutover, type Cutover } from "@/domain/crm-import/cutover";

const MAX_BYTES = 4 * 1024 * 1024;

/** Sube el .xlsx exportado del CRM y arma un lote para revisar. No escribe en RELEVO todavía. */
export async function uploadCrm(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  if (readCutover(ctx.workspace.settings).status === "cerrado") {
    return { message: "El corte del Sheet ya se registró: RELEVO es la fuente de verdad y el Sheet queda como respaldo. Para volver a importar, el owner tiene que reabrirlo (con motivo)." };
  }
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

/**
 * "Aprobar lote": aprueba las filas que el triage marca como importables (nuevas sin coincidencias o
 * cambios de rutina del Sheet). Conflictos, duplicados, cambios materiales y datos dudosos quedan
 * para revisión humana; lo bloqueado no entra. Misma función que arma el resumen de la página.
 */
export async function approveBatch(slug: string, batchId: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data } = await supabase.from("import_rows").select("id, entity_type, external_id, action, decision, raw, mapped, issues, conflicts").eq("batch_id", batchId);
  const rows = (data ?? []) as unknown as TriageRow[];
  const triage = triageBatch(rows);
  let n = 0;
  for (const r of rows) {
    if (r.decision !== "pendiente" || triage.get(r.id)?.lane !== "importable") continue;
    const res = await decideRow(supabase, r.id, "aprobada", {}, ctx.user.id);
    if (!res.error) n++;
  }
  revalidatePath(`/w/${slug}/integraciones/importar`, "layout");
  return { ok: true, message: n ? `${n} filas aprobadas. Revisá las excepciones y escribí el lote en RELEVO.` : "No hay filas importables pendientes." };
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
  if (res.applied) return { ok: true, message: `Listo: ${res.applied} filas escritas en RELEVO.` };
  if (res.unchanged) return { ok: true, message: `Lote cerrado: ${res.unchanged} registros sin cambios (procedencia actualizada).` };
  return { ok: true, message: "No había filas aprobadas por aplicar." };
}

export async function discardImport(slug: string, batchId: string): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return;
  const supabase = await createClient();
  await supabase.from("import_batches").update({ status: "descartado", closed_at: new Date().toISOString() }).eq("id", batchId).eq("status", "en_revision");
  revalidatePath(`/w/${slug}/integraciones`, "layout");
}

// ---------------------------------------------------------------------------------
// Corte del Sheet: transición explícita y auditable (sin sincronización bidireccional)
// ---------------------------------------------------------------------------------

async function saveCutover(slug: string, mutate: (c: Cutover, who: string) => Cutover | string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (ctx.role !== "owner") return { message: "Solo el owner decide el corte del Sheet." };
  const current = readCutover(ctx.workspace.settings);
  const who = ctx.user.email ?? ctx.user.id;
  const next = mutate(current, who);
  if (typeof next === "string") return { message: next };
  const supabase = await createClient();
  const settings = { ...((ctx.workspace.settings as Record<string, unknown> | null) ?? {}), sheet_cutover: next };
  const { data, error } = await supabase.from("workspaces").update({ settings }).eq("id", ctx.workspace.id).select("id");
  if (error) return { message: dbErrorMessage(error) };
  if (!data?.length) return { message: "Solo el owner puede cambiar esta configuración." };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Registrado." };
}

export async function setCutoffDate(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const date = String(fd.get("cutoff_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { errors: { cutoff_on: "Elegí la fecha de corte." } };
  return saveCutover(slug, (c, who) =>
    c.status === "cerrado" ? "El corte ya se registró." : { ...c, cutoff_on: date, history: [...c.history, { at: new Date().toISOString(), by: who, action: "fecha", note: `Fecha de corte: ${date}` }] },
  );
}

export async function closeSheet(slug: string, batchId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  if (fd.get("confirm") !== "on") return { message: "Confirmá que revisaste la reconciliación." };
  return saveCutover(slug, (c, who) => {
    if (c.status === "cerrado") return "El corte ya se registró.";
    const now = new Date().toISOString();
    return { ...c, status: "cerrado", closed_at: now, closed_by: who, reconciliation_batch_id: batchId, history: [...c.history, { at: now, by: who, action: "corte", note: `Reconciliación final: lote ${batchId}. Desde ahora RELEVO es la fuente de verdad.` }] };
  });
}

export async function reopenSheet(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 5) return { errors: { reason: "Escribí el motivo de la reapertura." } };
  return saveCutover(slug, (c, who) =>
    c.status !== "cerrado" ? "El Sheet no está cerrado." : { ...c, status: "activo", closed_at: null, closed_by: null, history: [...c.history, { at: new Date().toISOString(), by: who, action: "reapertura", note: reason }] },
  );
}
