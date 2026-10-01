import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * Congela la línea de base de una misión: el último análisis de cada hipótesis activa queda marcado como
 * punto de partida, para comparar después (confirma / contradice / línea nueva). Reejecutable: mueve la
 * marca al análisis más reciente. No crea versiones visibles.
 */
export async function freezeBaseline(db: Db, campaignId: string): Promise<{ frozen: number; withoutAnalysis: string[] }> {
  const { data: fs } = await db
    .from("findings")
    .select("id, statement, finding_assessments(id, created_at)")
    .neq("review_status", "rechazado")
    .eq("case_status", "activo")
    .or(`campaign_id.eq.${campaignId},campaign_id.is.null`);
  await db.from("finding_assessments").update({ baseline_campaign_id: null }).eq("baseline_campaign_id", campaignId);
  const ids: string[] = [];
  const withoutAnalysis: string[] = [];
  for (const f of fs ?? []) {
    const latest = [...f.finding_assessments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (latest) ids.push(latest.id);
    else withoutAnalysis.push(f.statement);
  }
  if (ids.length) {
    const { error } = await db.from("finding_assessments").update({ baseline_campaign_id: campaignId }).in("id", ids);
    if (error) throw error;
  }
  return { frozen: ids.length, withoutAnalysis };
}
