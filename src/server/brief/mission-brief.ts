import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_BRIEF_ITEMS, MissionBriefSchema, tidyBrief, type MissionBrief } from "@/domain/brief/mission-brief";
import { deepCall } from "@/server/mission/deep";
import type { CollectedItem } from "./collect";
import { BRIEF_MODEL } from "./engines";
import { OPPORTUNITY_QUERIES, RESEARCH_BASE, missionContext, pilotCollect, research } from "./pilot";
import { originalUrl } from "@/server/news/original-url";
import { placeSignal, type Placement } from "@/domain/material";
import { knownEvents } from "@/server/mission/material";

// El Morning Brief (elegido después de los pilotos): una sola corrida diaria que parte de la misión y lee
// lo que pasa afuera también con lente de oportunidad. Los pasos se usan desde la máquina de estados del
// Brief oficial (pipeline.ts); runMissionBrief los corre juntos y en seco para probar.

type Db = SupabaseClient<Database>;
export type MissionItem = CollectedItem & { alreadySeen: boolean; query: string };

const RESEARCH = `${RESEARCH_BASE}
Leé todo también con lente de oportunidad: además de lo que cambia la misión, buscá lo que podría convertirse en negocio (problemas y cuellos de botella, demanda que se repite, servicios que faltan, infraestructura insuficiente, empresas y contratistas que entran o crecen, búsquedas de personal, licitaciones, activos y cambios de precio). Ejemplos de lo que sí sirve: una fecha que cambia nuestra agenda y obliga a decidir; un local disponible con precio; una empresa que busca depósito o proveedores en la zona.
Usá web_search y web_fetch: abrí las notas que podrían importar (un titular no alcanza para afirmar nada) y buscá lo que las notas no cubren de la agenda, los pedidos de aviso y las preguntas abiertas de la misión.`;

const SYSTEM = `Sos RELEVO escribiendo el Morning Brief de una misión. No es un newsletter ni un clipping: es "qué cambió desde ayer, qué significa para lo que buscamos y qué haría".
Solo entra lo que cambia una hipótesis, una decisión, una prioridad, la agenda o una acción, o lo que puede convertirse en una oportunidad concreta. Una re-confirmación de algo que ya sabemos NO entra (va a descartados como ya_lo_sabiamos). Lo que ya reportamos o descartamos no vuelve, salvo que cambie.
Como mucho ${MAX_BRIEF_ITEMS}. Si nada cambia, quiet=true y decilo con naturalidad: "hoy no pasó nada relevante" es un buen Brief.
Distinguí hecho, declaración, aviso comercial (lo que dice el vendedor) e hipótesis (lectura nuestra): nunca inventes certeza. Cada cosa con su fuente (URL). Refs solo de la memoria. Escribí corto, en español rioplatense.`;

/** La misión del Brief: la configurada en settings.brief.campaign_ids (si sigue activa) o, si no hay, la primera misión activa. */
export async function briefMissionId(db: Db, workspaceId: string, settings: unknown): Promise<string | null> {
  const configured = (settings as { brief?: { campaign_ids?: string[] } } | null)?.brief?.campaign_ids;
  if (configured?.length) {
    // Una misión eliminada (archivada) no tiene Brief: no se cae a otra misión sin que nadie lo decida.
    const { data } = await db.from("campaigns").select("id").eq("id", configured[0]).is("archived_at", null).maybeSingle();
    return data?.id ?? null;
  }
  const { data } = await db.from("campaigns").select("id").eq("workspace_id", workspaceId).eq("kind", "mision").is("archived_at", null).order("created_at").limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * A quién le llega el Brief de la misión: los miembros de la misión que lo reciben (lo decide quien la creó,
 * en Compartir misión) más la lista del workspace, sin repetir. Una investigación → un Brief → N destinatarios.
 */
export async function briefRecipients(db: Db, missionId: string, listed: { name: string; email: string }[]): Promise<{ name: string; email: string }[]> {
  const { data: members } = await db.from("campaign_members").select("user_id").eq("campaign_id", missionId).eq("brief_email", true);
  const { data: profs } = members?.length ? await db.from("profiles").select("email, display_name").in("user_id", members.map((m) => m.user_id)) : { data: [] };
  const out = new Map<string, { name: string; email: string }>();
  for (const r of listed) out.set(r.email.trim().toLowerCase(), { name: r.name, email: r.email.trim().toLowerCase() });
  for (const p of profs ?? []) {
    const email = p.email.trim().toLowerCase();
    if (email.includes("@") && !out.has(email)) out.set(email, { name: p.display_name ?? "", email });
  }
  return [...out.values()];
}

export async function collectForMission(db: Db, workspaceId: string, missionId: string) {
  const mission = await missionContext(db, missionId);
  return pilotCollect(db, workspaceId, { queries: [...mission.queries, ...OPPORTUNITY_QUERIES], days: 2, vmn: true, max: 50 });
}

export async function researchForMission(db: Db, missionId: string, items: CollectedItem[], client: Anthropic = new Anthropic()) {
  const mission = await missionContext(db, missionId);
  return research(client, RESEARCH, mission.text, items, 6);
}

export async function writeMissionBrief(db: Db, o: { workspaceId: string; missionId: string; memo: string; items: MissionItem[]; client?: Anthropic }) {
  const mission = await missionContext(db, o.missionId);
  const s = await deepCall(db, {
    workspaceId: o.workspaceId,
    promptVersion: "brief-mision-v1",
    model: BRIEF_MODEL,
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

type Item = MissionBrief["items"][number];
const refIds = (refs: string[], type: string) => refs.filter((r) => r.startsWith(`${type}:`)).map((r) => r.slice(type.length + 1));

/**
 * Artículo ≠ hecho: lo que el Brief iba a mostrar y la misión ya conoce (otro medio, otras palabras) sale
 * del Brief y queda como fuente más de ese hecho; si trae un dato nuevo (monto, fecha, operador…) se
 * muestra como actualización. No depende solo de que el modelo se acuerde de lo que ya reportamos.
 */
export async function dedupeMissionBrief(db: Db, missionId: string, brief: MissionBrief, briefId?: string): Promise<{ brief: MissionBrief; shown: Placement[]; repeated: { item: Item; place: Placement }[] }> {
  const known = await knownEvents(db, missionId, 60, { exceptBrief: briefId });
  const items: Item[] = [];
  const shown: Placement[] = [];
  const repeated: { item: Item; place: Placement }[] = [];
  for (const x of brief.items) {
    const company_ids = refIds(x.connects, "company");
    const asset_ids = refIds(x.connects, "asset");
    const place = placeSignal({ headline: x.title, summary: null, company_ids, asset_ids, change: "nuevo", relevance: "alta" }, known);
    if (place.kind === "misma") { repeated.push({ item: x, place }); continue; }
    items.push(x);
    shown.push(place);
    if (place.kind === "nueva") known.push({ id: `brief-${items.length}`, headline: x.title, summary: null, happened_on: null, story_id: null, text: x.title, company_ids, asset_ids });
  }
  if (!repeated.length) return { brief, shown, repeated };
  const discarded = [...brief.discarded, ...repeated.map((r) => ({ title: r.item.title, reason: "ya_lo_sabiamos" as const }))].slice(0, 25);
  const quiet = items.length === 0;
  return { brief: { ...brief, items, discarded, quiet, opening: quiet ? "Hoy no pasó nada relevante para la misión." : brief.opening }, shown, repeated };
}

const BASIS: Record<MissionBrief["items"][number]["basis"], "hecho" | "declaracion" | "inferencia"> = { hecho: "hecho", declaracion: "declaracion", aviso_comercial: "declaracion", hipotesis: "inferencia" };

/**
 * Lo mostrado queda como señal de la misión (así mañana no se repite) y lo leído, como visto. Lo que repetía
 * un hecho conocido queda como fuente más de ese hecho (no material: no despierta la síntesis ni Avanzar).
 * Idempotente: si el paso se reintenta, no duplica señales.
 */
export async function saveMissionBrief(db: Db, o: { workspaceId: string; briefId: string; missionId: string; brief: MissionBrief; items: MissionItem[]; shown?: Placement[]; repeated?: { item: Item; place: Placement }[] }) {
  await db.from("brief_signals").delete().eq("brief_id", o.briefId);
  const row = (x: Item, position: number, place: Placement | undefined) => ({
    workspace_id: o.workspaceId, brief_id: o.briefId, position, headline: x.title.slice(0, 400), summary: x.why_us || null,
    source_url: /^https?:\/\//.test(x.source_url) ? x.source_url : null, publisher: x.source_name || null,
    basis: BASIS[x.basis], signal_type: x.opportunity ? "nuevo_negocio" : "otro", section: "general" as const,
    change: place?.change === "confirmado" ? "confirmado" : place?.kind === "actualiza" ? "actualizado" : "nuevo", relevance: "alta" as const,
    why_it_matters: x.why_us || null, reading: x.opportunity || null, suggested_action: x.action || null,
    campaign_ids: [o.missionId], company_ids: refIds(x.connects, "company"), finding_ids: refIds(x.connects, "finding"), asset_ids: refIds(x.connects, "asset"),
    event_id: place && place.kind !== "nueva" ? place.eventId : null, material: place ? place.material : true,
  });
  const rows = [
    ...o.brief.items.map((x, i) => row(x, i, o.shown?.[i])),
    ...(o.repeated ?? []).map((r, i) => row(r.item, o.brief.items.length + i, r.place)),
  ];
  if (rows.length) {
    const { error } = await db.from("brief_signals").insert(rows);
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
