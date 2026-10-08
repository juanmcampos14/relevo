import "server-only";

import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { parseCrmWorkbook, parseTab, parseTables, SHEETS, type ParsedWorkbook, type SheetKey } from "@/server/crm-import/parse";
import type { RawRow } from "@/domain/crm-import/map";
import { applyBatch } from "@/server/crm-import/apply";
import { planImport, stageImport } from "@/server/crm-import/stage";
import { reconcileRadar } from "@/server/radar/reconcile";
import { aogStops, routeStops, type FieldStop } from "@/domain/field-plan";
import { applyStops, crmCompanies, retireStops } from "./field";

// El Sheet operativo como fuente viva. Cada corrida: ¿cambió el archivo? → ¿qué filas cambiaron? (huella
// por fila) → solo eso pasa por la reconciliación: el Radar por el motor del Bloque B; empresas, contactos,
// actividades y fuentes por el diff de tres vías del importador (lo que se corrigió en RELEVO no se pisa:
// queda como información diferente). Sin cambios → no hace nada. Todo queda registrado (sheet_syncs).

type Db = SupabaseClient<Database>;
type Raw = { row: number; values: Record<string, string | null> };
const RADAR = "RADAR DE MERCADO";
const RUTA = "RUTA | VISITAS";
const AOG = "AOG | MAPA FÍSICO";

/** Una fila del CRM de RUTA o AOG como fila con ID (la pestaña no lo tiene): sus paradas y su clasificación. */
function fieldRows(stops: FieldStop[]): Raw[] {
  const byRow = new Map<string, FieldStop[]>();
  for (const s of stops) byRow.set(s.rowId, [...(byRow.get(s.rowId) ?? []), s]);
  return [...byRow.entries()].map(([id, list], i) => ({ row: i, values: { ID: id, paradas: JSON.stringify(list.map((s) => ({ ...s, rowId: undefined }))) } }));
}
const CRM_TABS: SheetKey[] = ["companies", "contacts", "tasks", "sources"];
const TAB_NAME: Record<SheetKey, string> = { companies: "EMPRESAS", contacts: "RED | CONTACTOS", tasks: "ACTIVIDADES", sources: "FUENTES" };

const hashOf = (v: Record<string, string | null>) => createHash("sha256").update(JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k] ?? null]))).digest("hex").slice(0, 32);
const idOf = (r: Raw) => (r.values["ID"] ?? "").trim().toUpperCase();
type Conflict = { field: string; sheet: unknown; relevo: unknown };
/** El importador guarda los conflictos como { conflicts: [...] } (o una lista, en filas viejas). */
/** ¿La fila vaciaría un dato que RELEVO tiene? (una columna renombrada o borrada no puede borrar información en silencio). */
const emptiesData = (c: unknown) => ((c as { updates?: { from: unknown; to: unknown }[] } | null)?.updates ?? []).some((u) => u.from !== null && u.from !== "" && (u.to === null || u.to === ""));
const conflictsOf = (c: unknown): Conflict[] => (Array.isArray(c) ? c : ((c as { conflicts?: Conflict[] } | null)?.conflicts ?? []));

export type SyncResult = {
  status: "sin_cambios" | "procesado" | "error";
  changed: Record<string, { nuevas: string[]; modificadas: string[] }>;
  result: {
    crm?: { batchId: string; aplicadas: number; sinCambios: number; paraRevisar: number; informacionDiferente: number; errores: { external_id: string; message: string }[] };
    radar?: { creadas: number; reconciliadas: number; activosNuevos: number; discrepancias: number; material: number; tareas: number; costUsd: number };
    campo?: { creadas: number; actualizadas: number; sinFecha: number; porClase: Record<string, number>; retiradas?: string[]; lecturaDudosa?: string[] };
    /** IDs repetidos en una pestaña del CRM: esas filas no se procesan (no hay cómo saber cuál vale). */
    idsDuplicados?: Record<string, string[]>;
  };
  batchIds: string[];
  error?: string;
};

/** Filas con un ID que aparece una sola vez; las de IDs repetidos se apartan para informarlas. */
function uniqueIds<R extends Raw>(rows: R[]): { rows: R[]; duplicated: string[] } {
  const count = new Map<string, number>();
  for (const r of rows) count.set(idOf(r), (count.get(idOf(r)) ?? 0) + 1);
  const duplicated = [...count.entries()].filter(([id, n]) => id && n > 1).map(([id]) => id);
  return { rows: rows.filter((r) => (count.get(idOf(r)) ?? 0) <= 1), duplicated };
}

/** Qué filas cambiaron desde la última vez (nuevas o con otra huella). */
async function delta<R extends Raw>(db: Db, workspaceId: string, sheetId: string, tab: string, rows: R[]) {
  const { data } = await db.from("sheet_rows").select("external_id, row_hash").eq("workspace_id", workspaceId).eq("sheet_id", sheetId).eq("tab", tab);
  const seen = new Map((data ?? []).map((r) => [r.external_id, r.row_hash]));
  const nuevas: R[] = [];
  const modificadas: R[] = [];
  for (const r of rows) {
    const id = idOf(r);
    if (!id) continue;
    const prev = seen.get(id);
    if (prev === undefined) nuevas.push(r);
    else if (prev !== hashOf(r.values)) modificadas.push(r);
  }
  return { nuevas, modificadas };
}

async function remember(db: Db, workspaceId: string, sheetId: string, tab: string, rows: Raw[], batchId: string | null) {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 200) {
    await db.from("sheet_rows").upsert(rows.slice(i, i + 200).map((r) => ({ workspace_id: workspaceId, sheet_id: sheetId, tab, external_id: idOf(r), row_hash: hashOf(r.values), row_number: r.row, values: r.values as unknown as NonNullable<Json>, last_changed_at: now, last_processed_at: now, last_batch_id: batchId })), { onConflict: "workspace_id,sheet_id,tab,external_id" });
  }
}

export async function syncSheet(
  db: Db,
  o: { workspaceId: string; missionId: string; sheetId: string; buffer: ArrayBuffer; modifiedAt?: string | null; trigger: "cron" | "manual" | "prueba"; client?: Pick<Anthropic, "beta">; dryRun?: boolean },
): Promise<SyncResult & { plan?: Record<string, Record<string, number>> }> {
  if (o.dryRun) return previewSheet(db, o);
  const { data: run } = await db.from("sheet_syncs").insert({ workspace_id: o.workspaceId, sheet_id: o.sheetId, trigger: o.trigger, sheet_modified_at: o.modifiedAt ?? null, status: "procesado" }).select("id").single();
  const out: SyncResult = { status: "sin_cambios", changed: {}, result: {}, batchIds: [] };
  try {
    // 1. Pestañas del CRM: solo las filas que cambiaron pasan por el diff de tres vías.
    const parsed = await parseCrmWorkbook(o.buffer);
    const crmChanged: Partial<Record<SheetKey, RawRow[]>> = {};
    const duplicated: Record<string, string[]> = {};
    for (const k of CRM_TABS) {
      const u = uniqueIds(parsed.rows[k]);
      if (u.duplicated.length) duplicated[TAB_NAME[k]] = u.duplicated;
      const d = await delta<RawRow>(db, o.workspaceId, o.sheetId, TAB_NAME[k], u.rows);
      if (d.nuevas.length || d.modificadas.length) {
        crmChanged[k] = [...d.nuevas, ...d.modificadas];
        out.changed[TAB_NAME[k]] = { nuevas: d.nuevas.map(idOf), modificadas: d.modificadas.map(idOf) };
      }
    }
    if (Object.keys(crmChanged).length) {
      const filtered: ParsedWorkbook = { ...parsed, rows: { companies: crmChanged.companies ?? [], contacts: crmChanged.contacts ?? [], tasks: crmChanged.tasks ?? [], sources: crmChanged.sources ?? [] } };
      const batchId = await stageImport(db, o.workspaceId, filtered, { fileName: `Sheet operativo · sincronización ${new Date().toISOString().slice(0, 16)}`, sha256: createHash("sha256").update(Buffer.from(o.buffer)).digest("hex") });
      // Lo que no choca con nada se aplica solo; lo que choca con una corrección de RELEVO queda como
      // información diferente (y la fila, pendiente en el lote); los posibles duplicados, para revisar.
      const { data: rows } = await db.from("import_rows").select("id, external_id, action, issues, conflicts, entity_type, target_entity_id, mapped").eq("batch_id", batchId);
      const safe = (rows ?? []).filter((r) => (r.action === "crear" || r.action === "actualizar") && !conflictsOf(r.conflicts).length && !(r.issues as { severity: string }[]).some((i) => i.severity === "bloquea" || i.severity === "revisar") && !emptiesData(r.conflicts));
      if (safe.length) await db.from("import_rows").update({ decision: "aprobada", decided_at: new Date().toISOString() }).in("id", safe.map((r) => r.id));
      const applied = safe.length ? await applyBatch(db, o.workspaceId, batchId) : { applied: 0, unchanged: 0, errors: [] };
      let diferente = 0;
      for (const r of (rows ?? []).filter((x) => conflictsOf(x.conflicts).length && x.target_entity_id && (x.entity_type === "company" || x.entity_type === "contact"))) {
        for (const c of conflictsOf(r.conflicts)) {
          const { error } = await db.from("source_discrepancies").upsert({ workspace_id: o.workspaceId, entity_type: r.entity_type as "company" | "contact", entity_id: r.target_entity_id!, field: c.field, current_value: c.relevo == null ? null : String(c.relevo), incoming_value: c.sheet == null ? null : String(c.sheet), source: "google_sheets", source_ref: r.external_id }, { ignoreDuplicates: true });
          if (!error) diferente++;
        }
      }
      const pending = (rows ?? []).filter((r) => r.action !== "sin_cambios" && !safe.includes(r)).length;
      if (!pending) await db.from("import_batches").update({ status: "aplicado", closed_at: new Date().toISOString() }).eq("id", batchId);
      out.result.crm = { batchId, aplicadas: applied.applied, sinCambios: (rows ?? []).filter((r) => r.action === "sin_cambios").length, paraRevisar: pending, informacionDiferente: diferente, errores: applied.errors };
      out.batchIds.push(batchId);
      for (const k of Object.keys(crmChanged) as SheetKey[]) await remember(db, o.workspaceId, o.sheetId, TAB_NAME[k], crmChanged[k]!, batchId);
    }

    // 2. Radar: solo las filas nuevas o modificadas, por la reconciliación del Bloque B.
    const radarU = uniqueIds(await parseTab(o.buffer, RADAR, "Hallazgo"));
    if (radarU.duplicated.length) duplicated[RADAR] = radarU.duplicated;
    if (Object.keys(duplicated).length) out.result.idsDuplicados = duplicated;
    const rd = await delta(db, o.workspaceId, o.sheetId, RADAR, radarU.rows);
    const radarChanged = [...rd.nuevas, ...rd.modificadas];
    if (radarChanged.length) {
      out.changed[RADAR] = { nuevas: rd.nuevas.map(idOf), modificadas: rd.modificadas.map(idOf) };
      const r = await reconcileRadar(db, { workspaceId: o.workspaceId, missionId: o.missionId, buffer: o.buffer, fileName: `Sheet operativo · RADAR · ${new Date().toISOString().slice(0, 16)}`, dryRun: false, client: o.client, onlyRefs: new Set(radarChanged.map(idOf)) });
      out.result.radar = {
        creadas: r.run.outcomes.filter((x) => x.action === "crear").length,
        reconciliadas: r.run.outcomes.filter((x) => x.action === "sin_cambios" || x.action === "actualizar").length,
        activosNuevos: r.import.assets.created.length,
        discrepancias: r.import.assets.discrepancies.length,
        material: r.run.outcomes.filter((x) => x.material).length,
        tareas: r.run.outcomes.reduce((n, x) => n + x.taskIds.length, 0),
        costUsd: r.run.costUsd,
      };
      if (r.run.batchId) out.batchIds.push(r.run.batchId);
      await remember(db, o.workspaceId, o.sheetId, RADAR, radarChanged, r.run.batchId);
    }
    // 3. Campo: RUTA | VISITAS y AOG | MAPA FÍSICO → paradas de la agenda, con la clasificación aprobada.
    //    La huella incluye la clasificación (si una empresa entra a EMPRESAS, la parada se reclasifica).
    const companies = await crmCompanies(db, o.workspaceId);
    const known = new Set(companies.keys());
    const year = new Date().getFullYear();
    const route = (await parseTables(o.buffer, RUTA, ["Punto de visita"]))["Punto de visita"];
    const aog = await parseTables(o.buffer, AOG, ["Actor", "Quién / empresa"]);
    const maps = new Map(((await parseTables(o.buffer, "MAPA | IMPORTAR", ["ID CRM / mapa"]))["ID CRM / mapa"]).map((r) => [(r.values["ID CRM / mapa"] ?? "").trim().toUpperCase(), r.values["Vertical"] ?? ""]));
    const stops = [...routeStops(route, { year, companies: known, maps }), ...aogStops(aog["Actor"], aog["Quién / empresa"], { year, companies: known, eventDay: `${year}-10-20` })];
    for (const [tab, list] of [[RUTA, stops.filter((s) => s.rowId.startsWith("RUTA:"))], [AOG, stops.filter((s) => !s.rowId.startsWith("RUTA:"))]] as const) {
      const rows = fieldRows(list);
      const gone = await retireStops(db, { workspaceId: o.workspaceId, sheetId: o.sheetId, tab, currentRowIds: new Set(rows.map(idOf)) });
      if (gone.retiradas.length || gone.dudosa) {
        const prev = out.result.campo ?? { creadas: 0, actualizadas: 0, sinFecha: 0, porClase: {} };
        out.result.campo = { ...prev, retiradas: [...(prev.retiradas ?? []), ...gone.retiradas], lecturaDudosa: gone.dudosa ? [...(prev.lecturaDudosa ?? []), tab] : prev.lecturaDudosa };
        if (gone.retiradas.length) out.changed[`${tab} · retiradas`] = { nuevas: [], modificadas: gone.retiradas };
      }
      const fd = await delta(db, o.workspaceId, o.sheetId, tab, rows);
      const changedIds = new Set([...fd.nuevas, ...fd.modificadas].map(idOf));
      if (!changedIds.size) continue;
      out.changed[tab] = { nuevas: fd.nuevas.map(idOf), modificadas: fd.modificadas.map(idOf) };
      const r = await applyStops(db, { workspaceId: o.workspaceId, missionId: o.missionId, stops: list.filter((s) => changedIds.has(s.rowId.toUpperCase())), companies });
      const prev = out.result.campo ?? { creadas: 0, actualizadas: 0, sinFecha: 0, porClase: {} };
      for (const [k, n] of Object.entries(r.porClase)) prev.porClase[k] = (prev.porClase[k] ?? 0) + n;
      out.result.campo = { ...prev, creadas: prev.creadas + r.creadas, actualizadas: prev.actualizadas + r.actualizadas, sinFecha: prev.sinFecha + r.sinFecha, porClase: prev.porClase };
      await remember(db, o.workspaceId, o.sheetId, tab, [...fd.nuevas, ...fd.modificadas], null);
    }

    out.status = Object.keys(out.changed).length ? "procesado" : "sin_cambios";
  } catch (e) {
    out.status = "error";
    out.error = (e as Error).message;
  }
  if (run) await db.from("sheet_syncs").update({ status: out.status, changed: out.changed as unknown as NonNullable<Json>, result: out.result as unknown as NonNullable<Json>, batch_ids: out.batchIds, error: out.error ?? null, finished_at: new Date().toISOString() }).eq("id", run.id);
  return out;
}

/** La configuración de la sincronización del workspace (qué Sheet, para qué misión). */
export function sheetSyncSettings(settings: unknown): { sheetId: string; missionId: string; enabled: boolean } | null {
  const s = (settings as { sheet_sync?: { sheet_id?: string; mission_id?: string; enabled?: boolean } } | null)?.sheet_sync;
  return s?.sheet_id && s.mission_id ? { sheetId: s.sheet_id, missionId: s.mission_id, enabled: s.enabled !== false } : null;
}

export { SHEETS };

/** En seco: qué cambió y qué haría el diff de tres vías con eso (sin escribir nada ni llamar a la IA). */
async function previewSheet(db: Db, o: { workspaceId: string; sheetId: string; buffer: ArrayBuffer }): Promise<SyncResult & { plan: Record<string, Record<string, number>> }> {
  const parsed = await parseCrmWorkbook(o.buffer);
  const out: SyncResult & { plan: Record<string, Record<string, number>> } = { status: "sin_cambios", changed: {}, result: {}, batchIds: [], plan: {} };
  const rows: Partial<Record<SheetKey, RawRow[]>> = {};
  for (const k of CRM_TABS) {
    const d = await delta<RawRow>(db, o.workspaceId, o.sheetId, TAB_NAME[k], parsed.rows[k]);
    if (d.nuevas.length || d.modificadas.length) { rows[k] = [...d.nuevas, ...d.modificadas]; out.changed[TAB_NAME[k]] = { nuevas: d.nuevas.map(idOf), modificadas: d.modificadas.map(idOf) }; }
  }
  if (Object.keys(rows).length) {
    const { rows: planned } = await planImport(db, o.workspaceId, { ...parsed, rows: { companies: rows.companies ?? [], contacts: rows.contacts ?? [], tasks: rows.tasks ?? [], sources: rows.sources ?? [] } });
    for (const r of planned) {
      const t = (out.plan[r.entity_type] ??= {});
      const k = r.action === "crear" || r.action === "actualizar" ? ((r.issues as { severity: string }[]).some((i) => i.severity === "bloquea" || i.severity === "revisar") || conflictsOf(r.conflicts).length || emptiesData(r.conflicts) ? `${r.action}_revisar` : `${r.action}_solo`) : r.action;
      t[k] = (t[k] ?? 0) + 1;
    }
  }
  const rd = await delta(db, o.workspaceId, o.sheetId, RADAR, await parseTab(o.buffer, RADAR, "Hallazgo"));
  if (rd.nuevas.length || rd.modificadas.length) out.changed[RADAR] = { nuevas: rd.nuevas.map(idOf), modificadas: rd.modificadas.map(idOf) };
  out.status = Object.keys(out.changed).length ? "procesado" : "sin_cambios";
  return out;
}
