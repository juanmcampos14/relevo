import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_BRIEF_ITEMS, MissionBriefSchema, tidyBrief, type MissionBrief } from "@/domain/brief/mission-brief";
import { deepCall } from "@/server/mission/deep";
import type { CollectedItem } from "./collect";
import { OPPORTUNITY_QUERIES, RESEARCH_BASE, missionContext, pilotCollect, research } from "./pilot";
import { originalUrl } from "@/server/news/original-url";

// El Morning Brief (elegido después de los pilotos): una sola corrida diaria que parte de la misión y lee
// lo que pasa afuera también con lente de oportunidad. Los pasos se usan desde la máquina de estados del
// Brief oficial (pipeline.ts); runMissionBrief los corre juntos y en seco para probar.

type Db = SupabaseClient<Database>;
export type MissionItem = CollectedItem & { alreadySeen: boolean; query: string };

const RESEARCH = `${RESEARCH_BASE}
Leé todo también con lente de oportunidad: además de lo que cambia la misión, buscá lo que podría convertirse en negocio (problemas y cuellos de botella, demanda que se repite, servicios que faltan, infraestructura insuficiente, empresas y contratistas que entran o crecen, búsquedas de personal, licitaciones, activos y cambios de precio). Ejemplos de lo que sí sirve: una fecha que cambia nuestra agenda y obliga a decidir; un local disponible con precio; una empresa que busca depósito o proveedores en la zona.`;

const SYSTEM = `Sos RELEVO escribiendo el Morning Brief de una misión. No es un newsletter ni un clipping: es "qué cambió desde ayer, qué significa para lo que buscamos y qué haría".
Solo entra lo que cambia una hipótesis, una decisión, una prioridad, la agenda o una acción, o lo que puede convertirse en una oportunidad concreta. Una re-confirmación de algo que ya sabemos NO entra (va a descartados como ya_lo_sabiamos). Lo que ya reportamos o descartamos no vuelve, salvo que cambie.
Como mucho ${MAX_BRIEF_ITEMS}. Si nada cambia, quiet=true y decilo con naturalidad: "hoy no pasó nada relevante" es un buen Brief.
Distinguí hecho, declaración, aviso comercial (lo que dice el vendedor) e hipótesis (lectura nuestra): nunca inventes certeza. Cada cosa con su fuente (URL). Refs solo de la memoria. Escribí corto, en español rioplatense.`;

/** La misión del Brief: la configurada en settings.brief.campaign_ids o, si no hay, la primera misión. */
export async function briefMissionId(db: Db, workspaceId: string, settings: unknown): Promise<string | null> {
  const configured = (settings as { brief?: { campaign_ids?: string[] } } | null)?.brief?.campaign_ids;
  if (configured?.length) return configured[0];
  const { data } = await db.from("campaigns").select("id").eq("workspace_id", workspaceId).eq("kind", "mision").order("created_at").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function collectForMission(db: Db, workspaceId: string, missionId: string) {
  const mission = await missionContext(db, missionId);
  return pilotCollect(db, workspaceId, { queries: [...mission.queries, ...OPPORTUNITY_QUERIES], days: 2, vmn: true, max: 50 });
}

export async function researchForMission(db: Db, missionId: string, items: CollectedItem[], client: Anthropic = new Anthropic()) {
  const mission = await missionContext(db, missionId);
  return research(client, RESEARCH, mission.text, items, 10);
}

export async function writeMissionBrief(db: Db, o: { workspaceId: string; missionId: string; memo: string; items: MissionItem[]; client?: Anthropic }) {
  const mission = await missionContext(db, o.missionId);
  const s = await deepCall(db, {
    workspaceId: o.workspaceId,
    promptVersion: "brief-mision-v1",
    effort: "medium",
    schema: MissionBriefSchema,
    client: o.client,
    system: SYSTEM,
    prompt: `${mission.text}\n\nMEMO DE INVESTIGACIÓN:\n${o.memo}\n\nNOTAS RECOLECTADAS:\n${o.items.map((i) => `- ${i.publisher} · ${i.publishedAt ?? "s/f"} · ${i.title} · ${i.url}${i.alreadySeen ? " · (ya la vimos antes)" : ""}`).join("\n")}`,
  });
  if (!s.ok) throw new Error(s.message);
  const brief = tidyBrief(s.value, mission.refs);
  // Cada fuente, a la nota del medio: un clic en el mail o en RELEVO abre el artículo, no Google Noticias.
  const items = await Promise.all(brief.items.map(async (x) => ({ ...x, source_url: x.source_url ? await originalUrl(x.source_url) : "" })));
  return { brief: { ...brief, items }, costUsd: s.costUsd };
}

const BASIS: Record<MissionBrief["items"][number]["basis"], "hecho" | "declaracion" | "inferencia"> = { hecho: "hecho", declaracion: "declaracion", aviso_comercial: "declaracion", hipotesis: "inferencia" };

/** Lo mostrado queda como señal de la misión (así mañana no se repite) y lo leído, como visto. */
export async function saveMissionBrief(db: Db, o: { workspaceId: string; briefId: string; missionId: string; brief: MissionBrief; items: MissionItem[] }) {
  const ids = (refs: string[], type: string) => refs.filter((r) => r.startsWith(`${type}:`)).map((r) => r.slice(type.length + 1));
  for (const [position, x] of o.brief.items.entries()) {
    const { error } = await db.from("brief_signals").insert({
      workspace_id: o.workspaceId, brief_id: o.briefId, position, headline: x.title.slice(0, 400), summary: x.why_us || null,
      source_url: /^https?:\/\//.test(x.source_url) ? x.source_url : null, publisher: x.source_name || null,
      basis: BASIS[x.basis], signal_type: x.opportunity ? "nuevo_negocio" : "otro", section: "general", change: "nuevo", relevance: "alta",
      why_it_matters: x.why_us || null, reading: x.opportunity || null, suggested_action: x.action || null,
      campaign_ids: [o.missionId], company_ids: ids(x.connects, "company"), finding_ids: ids(x.connects, "finding"), asset_ids: ids(x.connects, "asset"),
    });
    if (error) throw error;
  }
  if (o.items.length) {
    await db.from("brief_source_items").upsert(
      o.items.map((i) => ({ workspace_id: o.workspaceId, url: i.url, title: i.title, publisher: i.publisher, published_at: i.publishedAt, first_brief_id: o.briefId })),
      { onConflict: "workspace_id,url", ignoreDuplicates: true },
    );
  }
}

export type MissionBriefRun = {
  brief: MissionBrief;
  seconds: number;
  costUsd: number;
  webSearches: number;
  collected: number;
  collectedAlreadySeen: number;
  sourcesConsulted: number;
  collectErrors: string[];
};

/** En seco: los tres pasos juntos, sin guardar ni enviar. */
export async function runMissionBrief(db: Db, o: { workspaceId: string; missionId: string; client?: Anthropic }): Promise<MissionBriefRun> {
  const started = Date.now();
  const client = o.client ?? new Anthropic();
  const { items, errors } = await collectForMission(db, o.workspaceId, o.missionId);
  const r = await researchForMission(db, o.missionId, items, client);
  const w = await writeMissionBrief(db, { workspaceId: o.workspaceId, missionId: o.missionId, memo: r.memo, items, client });
  return {
    brief: w.brief,
    seconds: (Date.now() - started) / 1000,
    costUsd: r.usage.costUsd + w.costUsd,
    webSearches: r.usage.webSearches,
    collected: items.length,
    collectedAlreadySeen: items.filter((i) => i.alreadySeen).length,
    sourcesConsulted: r.sources.length + items.length,
    collectErrors: errors,
  };
}
