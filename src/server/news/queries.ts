import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { RADAR_TOPICS } from "@/domain/news";
import { STALE_AFTER_MS, refreshNews } from "./refresh";

/**
 * Noticias del radar (Vaca Muerta + Añelo) y estado de la última actualización. Si algún tema
 * está vencido, programa su actualización DESPUÉS de responder (no demora la página). En after()
 * no hay cookies: se usa el cliente de servidor acotado a este workspace, solo para notas públicas;
 * la reserva atómica de refreshNews evita consultas duplicadas.
 */
export async function loadNews(db: SupabaseClient<Database>, workspaceId: string, limit: number, topics: readonly string[] = RADAR_TOPICS) {
  const [{ data: rows }, { data: runs }] = await Promise.all([
    db
      .from("news_articles")
      .select("id, title, url, source_name, published_at, snippet, finding_id, topic")
      .in("topic", [...topics])
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    db.from("news_fetch_runs").select("topic, status, error, created_at").in("topic", [...topics]).order("created_at", { ascending: false }).limit(20),
  ]);
  const lastOkByTopic = new Map<string, string>();
  for (const r of runs ?? []) if (r.status === "ok" && !lastOkByTopic.has(r.topic)) lastOkByTopic.set(r.topic, r.created_at);
  const stale = topics.filter((t) => {
    const at = lastOkByTopic.get(t);
    return !at || Date.now() - new Date(at).getTime() > STALE_AFTER_MS;
  });
  if (stale.length && process.env.SUPABASE_SECRET_KEY) {
    after(async () => {
      const admin = createAdminClient();
      for (const t of stale) await refreshNews(admin, workspaceId, t);
    });
  }
  const oks = [...lastOkByTopic.values()].sort();
  const last = runs?.[0];
  return {
    rows: rows ?? [],
    // La más vieja de las últimas actualizaciones: honesto sobre qué tan fresco está todo.
    lastOkAt: oks.length === topics.length ? oks[0] : null,
    lastError: last?.status === "error" ? last.error : null,
    refreshing: stale.length > 0,
  };
}
