import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { Issue } from "@/domain/crm-import/map";
import type { FieldChange, FieldConflict } from "@/domain/crm-import/diff";
import { pendingChoices, type Resolution } from "./apply";

type Db = SupabaseClient<Database>;

/**
 * Aprobar o rechazar una fila. Aprobar exige haber decidido cada propuesta a revisar y cada
 * conflicto campo por campo: la IA/el importador proponen, una persona promueve.
 */
export async function decideRow(db: Db, rowId: string, decision: "aprobada" | "rechazada", resolution: Resolution, userId: string): Promise<{ error?: string }> {
  const { data: row } = await db.from("import_rows").select("issues, conflicts, applied_at, action").eq("id", rowId).maybeSingle();
  if (!row) return { error: "Fila no encontrada." };
  if (row.applied_at) return { error: "La fila ya se aplicó." };
  if (decision === "aprobada") {
    if (row.action === "rechazar") return { error: "La fila tiene un problema que bloquea: corregilo en el Sheet y volvé a importar." };
    const missing = pendingChoices({
      issues: row.issues as unknown as Issue[],
      conflicts: row.conflicts as unknown as { updates?: FieldChange[]; conflicts?: FieldConflict[] },
      resolution,
    });
    if (missing.length) return { error: `Falta decidir: ${missing.join(" · ")}` };
  }
  const { error } = await db
    .from("import_rows")
    .update({ decision, resolution: resolution as unknown as NonNullable<Json>, decided_by: userId, decided_at: new Date().toISOString() })
    .eq("id", rowId);
  return error ? { error: error.message } : {};
}
