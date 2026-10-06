import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { exportSheet, serviceAccount, sheetModifiedAt } from "./google";
import { sheetSyncSettings, syncSheet, type SyncResult } from "./sync";

type Db = SupabaseClient<Database>;

/**
 * Una pasada para un workspace: si el Sheet no cambió desde la última sincronización, no se baja ni se
 * procesa nada (queda registrada la verificación); si cambió, se procesa solo el delta.
 */
export async function syncWorkspaceSheet(db: Db, workspaceId: string, settings: unknown, trigger: "cron" | "manual"): Promise<SyncResult | { status: "sin_configurar"; error: string }> {
  const cfg = sheetSyncSettings(settings);
  if (!cfg || !cfg.enabled) return { status: "sin_configurar", error: "El workspace no tiene un Sheet para sincronizar." };
  if (!serviceAccount()) return { status: "sin_configurar", error: "Falta la cuenta de servicio de Google (GOOGLE_SERVICE_ACCOUNT_JSON)." };
  const modifiedAt = await sheetModifiedAt(cfg.sheetId);
  const { data: last } = await db.from("sheet_syncs").select("sheet_modified_at").eq("workspace_id", workspaceId).eq("sheet_id", cfg.sheetId).neq("status", "error").not("sheet_modified_at", "is", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.sheet_modified_at && new Date(last.sheet_modified_at).getTime() === new Date(modifiedAt).getTime()) {
    await db.from("sheet_syncs").insert({ workspace_id: workspaceId, sheet_id: cfg.sheetId, trigger, sheet_modified_at: modifiedAt, status: "sin_cambios", finished_at: new Date().toISOString() });
    return { status: "sin_cambios", changed: {}, result: {}, batchIds: [] };
  }
  const buffer = await exportSheet(cfg.sheetId);
  return syncSheet(db, { workspaceId, missionId: cfg.missionId, sheetId: cfg.sheetId, buffer, modifiedAt, trigger });
}
