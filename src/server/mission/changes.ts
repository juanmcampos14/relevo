import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { moveIsFresh, MOVE_QUIET_H, type FocusItem } from "@/domain/focus";

// Qué cambió en una misión desde un momento: decide si el pulso vuelve a priorizar y si un Avanzar ya
// preparado sigue sirviendo (aparte del pulso para que moves.ts lo use sin importarse en círculo).

type Db = SupabaseClient<Database>;

/** ¿Pasó algo desde la última síntesis que cambie el presente? */
export async function changesSince(db: Db, missionId: string, since: string, workspaceId: string) {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [captures, actions, signals, assessments] = await Promise.all([
    count(db.from("captures").select("id", { count: "exact", head: true }).eq("campaign_id", missionId).gt("captured_at", since)),
    // Solo lo que se aplicó en este workspace (antes contaba cualquier workspace y despertaba pulsos ajenos).
    count(db.from("ai_action_drafts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "ejecutada").gt("decided_at", since)),
    count(db.from("brief_signals").select("id", { count: "exact", head: true }).contains("campaign_ids", [missionId]).in("relevance", ["alta", "media"]).gt("created_at", since)),
    count(db.from("finding_assessments").select("id, findings!inner(campaign_id)", { count: "exact", head: true }).eq("findings.campaign_id", missionId).gt("created_at", since)),
  ]);
  const { data: c } = await db.from("campaigns").select("synthesis").eq("id", missionId).maybeSingle();
  const log = ((c?.synthesis as { focus?: { log?: { at: string }[] } } | null)?.focus?.log ?? []).filter((l) => l.at > since).length;
  return { captures, actions, signals, assessments, corrections: log, any: captures + actions + signals + assessments + log > 0 };
}

/**
 * ¿El Avanzar preparado sigue sirviendo? Dentro de las 20 horas, si la prioridad no cambió. Después, hasta
 * MOVE_QUIET_H horas si en la misión no pasó nada desde que se preparó: rehacerlo daría lo mismo y cuesta.
 */
export async function moveServes(db: Db, m: { missionId: string; workspaceId: string }, it: FocusItem, now: Date): Promise<boolean> {
  if (moveIsFresh(it, now)) return true;
  if (!moveIsFresh(it, now, MOVE_QUIET_H)) return false;
  return !(await changesSince(db, m.missionId, it.move!.at, m.workspaceId)).any;
}
