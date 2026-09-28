import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { TOPICS, mentions } from "@/domain/news";
import { PROVIDER, fetchGoogleNews } from "./google-news";

export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Trae notas del tema, filtra las que no nombran el término y guarda las nuevas.
 * Idempotente: (workspace, proveedor, id externo) es único. Registra cada corrida,
 * incluidos los errores, para mostrar "última actualización" con honestidad.
 */
export async function refreshNews(
  db: SupabaseClient<Database>,
  workspaceId: string,
  topicKey = "vaca_muerta",
  { staleMs = STALE_AFTER_MS }: { staleMs?: number } = {},
) {
  const topic = TOPICS[topicKey];
  // Una sola actualización a la vez (reserva atómica en la base).
  const { data: won } = await db.rpc("claim_news_refresh", {
    p_ws: workspaceId,
    p_topic: topic.key,
    p_stale: `${Math.floor(staleMs / 1000)} seconds`,
  });
  if (!won) return { ok: true as const, received: 0, created: 0, skipped: true };
  try {
    const items = (await fetchGoogleNews(topic.query, 7)).filter((i) => mentions(i, topic.mustMention));
    let created = 0;
    if (items.length) {
      const { data, error } = await db
        .from("news_articles")
        .upsert(
          items.map((i) => ({
            workspace_id: workspaceId,
            topic: topic.key,
            provider: PROVIDER,
            external_id: i.externalId,
            url: i.url,
            title: i.title,
            source_name: i.sourceName,
            source_url: i.sourceUrl,
            snippet: i.snippet,
            published_at: i.publishedAt,
          })),
          { onConflict: "workspace_id,provider,external_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error("No se pudieron guardar las noticias");
      created = data?.length ?? 0;
    }
    await db.from("news_fetch_runs").insert({ workspace_id: workspaceId, topic: topic.key, provider: PROVIDER, status: "ok", received: items.length, created });
    await db.rpc("finish_news_refresh", { p_ws: workspaceId, p_topic: topic.key, p_ok: true });
    return { ok: true as const, received: items.length, created, skipped: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    await db.from("news_fetch_runs").insert({ workspace_id: workspaceId, topic: topic.key, provider: PROVIDER, status: "error", error: message });
    await db.rpc("finish_news_refresh", { p_ws: workspaceId, p_topic: topic.key, p_ok: false });
    return { ok: false as const, error: message };
  }
}
