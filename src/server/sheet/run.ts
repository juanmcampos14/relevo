import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { exportSheet, fileMeta, serviceAccount, sheetModifiedAt } from "./google";
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
  await refreshMissionDocs(db, workspaceId, settings).catch(() => null);
  const modifiedAt = await sheetModifiedAt(cfg.sheetId);
  const { data: last } = await db.from("sheet_syncs").select("sheet_modified_at").eq("workspace_id", workspaceId).eq("sheet_id", cfg.sheetId).neq("status", "error").not("sheet_modified_at", "is", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.sheet_modified_at && new Date(last.sheet_modified_at).getTime() === new Date(modifiedAt).getTime()) {
    await db.from("sheet_syncs").insert({ workspace_id: workspaceId, sheet_id: cfg.sheetId, trigger, sheet_modified_at: modifiedAt, status: "sin_cambios", finished_at: new Date().toISOString() });
    return { status: "sin_cambios", changed: {}, result: {}, batchIds: [] };
  }
  const buffer = await exportSheet(cfg.sheetId);
  return syncSheet(db, { workspaceId, missionId: cfg.missionId, sheetId: cfg.sheetId, buffer, modifiedAt, trigger });
}

type MissionDoc = { id: string; label: string; name?: string | null; modified_at?: string | null; access?: "ok" | "sin_acceso"; checked_at?: string };

/**
 * Documentos rectores de la misión (sheet_sync.docs: Mission Master, Field Plan): en cada pasada se
 * refresca su título y última modificación. Si la cuenta de servicio no tiene acceso, queda "sin_acceso".
 */
async function refreshMissionDocs(db: Db, workspaceId: string, settings: unknown) {
  const s = settings as { sheet_sync?: { docs?: MissionDoc[] } } | null;
  const docs = s?.sheet_sync?.docs;
  if (!docs?.length) return;
  const now = new Date().toISOString();
  const next = await Promise.all(docs.map(async (d) => {
    const m = await fileMeta(d.id).catch(() => null);
    return { ...d, name: m?.name ?? d.name ?? null, modified_at: m?.modifiedTime ?? d.modified_at ?? null, access: m ? ("ok" as const) : ("sin_acceso" as const), checked_at: now };
  }));
  const changed = next.some((d, i) => d.name !== docs[i].name || d.modified_at !== docs[i].modified_at || d.access !== docs[i].access);
  if (!changed) return;
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", workspaceId).single();
  const cur = (ws?.settings ?? {}) as Record<string, unknown> & { sheet_sync?: Record<string, unknown> };
  await db.from("workspaces").update({ settings: { ...cur, sheet_sync: { ...cur.sheet_sync, docs: next } } as never }).eq("id", workspaceId);
}
