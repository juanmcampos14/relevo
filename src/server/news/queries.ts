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
  const [{ data: rows }, { data: states }, { data: last }] = await Promise.all([
    db
      .from("news_articles")
      .select("id, title, url, source_name, published_at, snippet, finding_id, topic, image_url")
      .in("topic", [...topics])
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    // Única fuente de verdad sobre frescura: la misma tabla que usa la reserva atómica.
    db.from("news_refresh_state").select("topic, last_ok_at").in("topic", [...topics]),
    db.from("news_fetch_runs").select("status, error").in("topic", [...topics]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const lastOkByTopic = new Map((states ?? []).filter((s) => s.last_ok_at).map((s) => [s.topic, s.last_ok_at as string]));
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
  return {
    rows: rows ?? [],
    // La más vieja de las últimas actualizaciones: honesto sobre qué tan fresco está todo.
    lastOkAt: oks.length === topics.length ? oks[0] : null,
    lastError: last?.status === "error" ? last.error : null,
    refreshing: stale.length > 0,
  };
}
