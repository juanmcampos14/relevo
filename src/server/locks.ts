import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { changedFields, respectLocks, withLocks } from "@/domain/locks";

// Precedencia humana en la base: una edición o confirmación de una persona bloquea los campos que cambió;
// una ingesta automática respeta el bloqueo y deja lo distinto como discrepancia.

type Db = SupabaseClient<Database>;
export type LockedTable = "companies" | "contacts" | "establishments" | "assets";
const ENTITY: Record<LockedTable, "company" | "contact" | "establishment" | "asset"> = { companies: "company", contacts: "contact", establishments: "establishment", assets: "asset" };

/** Después de una edición humana: bloquea los campos que cambió (comparando contra cómo estaba antes). */
export async function lockAfterHumanEdit(db: Db, table: LockedTable, id: string, before: Record<string, unknown>, patch: Record<string, unknown>) {
  const fields = changedFields(before, patch).filter((f) => f !== "locked_fields" && f !== "updated_at");
  if (!fields.length) return;
  const locked = (before.locked_fields as string[] | null) ?? [];
  await db.from(table).update({ locked_fields: withLocks(locked, fields) } as never).eq("id", id);
}

/**
 * Lo que una ingesta puede escribir sobre una entidad existente: devuelve los campos libres y registra los
 * bloqueados que llegan distintos como discrepancia (una sola abierta por campo y valor).
 */
export async function ingestPatch<T extends Record<string, unknown>>(
  db: Db,
  o: { workspaceId: string; table: LockedTable; id: string; current: Record<string, unknown>; incoming: T; source: string; sourceRef?: string | null; sourceUrl?: string | null; dryRun?: boolean },
): Promise<{ apply: Partial<T>; discrepancies: number }> {
  const split = respectLocks(o.current, o.incoming, (o.current.locked_fields as string[] | null) ?? []);
  if (split.discrepancies.length && !o.dryRun) {
    await db.from("source_discrepancies").upsert(
      split.discrepancies.map((d) => ({ workspace_id: o.workspaceId, entity_type: ENTITY[o.table], entity_id: o.id, field: d.field, current_value: d.current, incoming_value: d.incoming, source: o.source, source_ref: o.sourceRef ?? null, source_url: o.sourceUrl ?? null })),
      { ignoreDuplicates: true },
    );
  }
  return { apply: split.apply, discrepancies: split.discrepancies.length };
}
