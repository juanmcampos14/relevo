"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { refreshNews } from "@/server/news/refresh";
import { RADAR_TOPICS } from "@/domain/news";
import { ingestFindings } from "@/server/ingest";
import type { ActionState } from "@/server/action-result";

export async function refreshNewsNow(slug: string, _: ActionState): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  // Manual: sin exigir antigüedad, pero igual respetando la reserva (no dos a la vez).
  const db = await createClient();
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const topic of RADAR_TOPICS) {
    const r = await refreshNews(db, ctx.workspace.id, topic, { staleMs: 0 });
    if (!r.ok) errors.push(r.error);
    else if (r.skipped) skipped++;
    else created += r.created;
  }
  revalidatePath(`/w/${slug}`, "layout");
  if (errors.length) return { message: `No se pudo actualizar: ${errors[0]}` };
  if (skipped === RADAR_TOPICS.length) return { ok: true, message: "Ya se está actualizando (o falló hace poco); probá en unos minutos." };
  return { ok: true, message: created ? `${created} noticias nuevas.` : "No hay noticias nuevas." };
}

/** La nota entra como hallazgo PENDIENTE de revisión (research externo). Nunca como oportunidad. */
export async function newsToFinding(slug: string, articleId: string): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return;
  const supabase = await createClient();
  const { data: a } = await supabase.from("news_articles").select("*").eq("id", articleId).maybeSingle();
  if (!a || a.finding_id) return;
  const r = await ingestFindings(
    supabase,
    ctx.workspace.id,
    [
      {
        url: a.url,
        title: a.source_name ? `${a.title} (${a.source_name})` : a.title,
        publisher: a.source_name ?? undefined,
        published_at: a.published_at?.slice(0, 10),
        statement: a.title,
        kind: "senal_de_mercado",
        evidence: a.snippet ?? undefined,
        topic: a.topic,
      },
    ],
    { sourceSystem: "radar-noticias" },
  );
  let findingId: string | undefined = r.finding_ids[0];
  if (!findingId && r.duplicates) {
    // Ya existía (misma URL + afirmación): se vincula el existente.
    const { data } = await supabase.from("findings").select("id, sources!inner(url)").eq("sources.url", a.url).limit(1).maybeSingle();
    findingId = data?.id;
  }
  if (findingId) await supabase.from("news_articles").update({ finding_id: findingId }).eq("id", articleId);
  revalidatePath(`/w/${slug}`, "layout");
}
