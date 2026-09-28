import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { STALE_AFTER_MS, refreshNews } from "./refresh";

/**
 * Noticias del tema + estado de la última actualización. Si están viejas, programa una
 * actualización DESPUÉS de responder (no demora la página). En after() no hay cookies:
 * se usa el cliente de servidor acotado a este workspace, solo para notas públicas.
 */
export async function loadNews(db: SupabaseClient<Database>, workspaceId: string, limit: number, topic = "vaca_muerta") {
  const [{ data: rows }, { data: lastOk }, { data: last }] = await Promise.all([
    db
      .from("news_articles")
      .select("id, title, url, source_name, published_at, snippet, finding_id")
      .eq("topic", topic)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    db.from("news_fetch_runs").select("created_at").eq("topic", topic).eq("status", "ok").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("news_fetch_runs").select("status, error, created_at").eq("topic", topic).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const stale = !lastOk || Date.now() - new Date(lastOk.created_at).getTime() > STALE_AFTER_MS;
  // La reserva atómica en refreshNews garantiza una sola consulta aunque se programe varias veces.
  if (stale && process.env.SUPABASE_SECRET_KEY) {
    after(async () => {
      await refreshNews(createAdminClient(), workspaceId, topic);
    });
  }
  return { rows: rows ?? [], lastOkAt: lastOk?.created_at ?? null, lastError: last?.status === "error" ? last.error : null, refreshing: stale };
}
