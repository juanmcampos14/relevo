import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MOVE_MAX_H } from "@/domain/material";
import type { FocusItem } from "@/domain/focus";
import { materialSince } from "./material";

// Qué cambió en una misión desde un momento: decide si el pulso vuelve a priorizar y si un Avanzar ya
// preparado sigue sirviendo (aparte del pulso para que moves.ts lo use sin importarse en círculo). Usa la
// misma definición de cambio material que la síntesis y "Desde tu última visita".

type Db = SupabaseClient<Database>;

/** ¿Pasó algo material desde `since`? */
export async function changesSince(db: Db, missionId: string, since: string, workspaceId: string) {
  return materialSince(db, { missionId, workspaceId, since });
}

/**
 * ¿El Avanzar preparado sigue sirviendo? Sí, mientras la prioridad no haya cambiado (la síntesis la marca
 * cuando algo material la toca), no haya llegado una señal material sobre sus empresas, personas,
 * activos o hipótesis, y no tenga más de MOVE_MAX_H horas (los textos llevan fechas relativas).
 * Sin cambio material → no se rehace.
 */
export async function moveServes(db: Db, m: { missionId: string; workspaceId: string }, it: FocusItem, now: Date): Promise<boolean> {
  if (!it.move || it.move.at < it.updated_at) return false;
  if (now.getTime() - new Date(it.move.at).getTime() >= MOVE_MAX_H * 3_600_000) return false;
  const refs = new Set(it.refs);
  if (!refs.size) return true;
  const { items } = await materialSince(db, { missionId: m.missionId, workspaceId: m.workspaceId, since: it.move.at, now });
  return !items.some((x) => x.kind === "senal" && x.refs.some((r) => refs.has(r)));
}
