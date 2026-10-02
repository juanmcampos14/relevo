import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_BRIEF_ITEMS, MissionBriefSchema, tidyBrief, type MissionBrief } from "@/domain/brief/mission-brief";
import { deepCall } from "@/server/mission/deep";
import { OPPORTUNITY_QUERIES, RESEARCH_BASE, missionContext, pilotCollect, research } from "./pilot";

// El Morning Brief elegido (después de los pilotos): una sola corrida diaria que parte de la misión y lee
// lo que pasa afuera también con lente de oportunidad. No guarda nada en el Brain ni envía: devuelve el
// Brief y sus números para revisarlo antes de reemplazar al oficial.

type Db = SupabaseClient<Database>;

const RESEARCH = `${RESEARCH_BASE}
Leé todo también con lente de oportunidad: además de lo que cambia la misión, buscá lo que podría convertirse en negocio (problemas y cuellos de botella, demanda que se repite, servicios que faltan, infraestructura insuficiente, empresas y contratistas que entran o crecen, búsquedas de personal, licitaciones, activos y cambios de precio). Ejemplos de lo que sí sirve: una fecha que cambia nuestra agenda y obliga a decidir; un local disponible con precio; una empresa que busca depósito o proveedores en la zona.`;

const SYSTEM = `Sos RELEVO escribiendo el Morning Brief de una misión. No es un newsletter ni un clipping: es "qué cambió desde ayer, qué significa para lo que buscamos y qué haría".
Solo entra lo que cambia una hipótesis, una decisión, una prioridad, la agenda o una acción, o lo que puede convertirse en una oportunidad concreta. Una re-confirmación de algo que ya sabemos NO entra (va a descartados como ya_lo_sabiamos). Lo que ya reportamos o descartamos no vuelve, salvo que cambie.
Como mucho ${MAX_BRIEF_ITEMS}. Si nada cambia, quiet=true y decilo con naturalidad: "hoy no pasó nada relevante" es un buen Brief.
Distinguí hecho, declaración, aviso comercial (lo que dice el vendedor) e hipótesis (lectura nuestra): nunca inventes certeza. Cada cosa con su fuente (URL). Refs solo de la memoria. Escribí corto, en español rioplatense.`;

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

export async function runMissionBrief(db: Db, o: { workspaceId: string; missionId: string; client?: Anthropic }): Promise<MissionBriefRun> {
  const started = Date.now();
  const client = o.client ?? new Anthropic();
  const mission = await missionContext(db, o.missionId);
  const { items, errors } = await pilotCollect(db, o.workspaceId, { queries: [...mission.queries, ...OPPORTUNITY_QUERIES], days: 2, vmn: true, max: 50 });
  const r = await research(client, RESEARCH, mission.text, items, 10);
  const s = await deepCall(db, {
    workspaceId: o.workspaceId,
    promptVersion: "brief-mision-v1",
    effort: "medium",
    schema: MissionBriefSchema,
    client,
    system: SYSTEM,
    prompt: `${mission.text}\n\nMEMO DE INVESTIGACIÓN:\n${r.memo}\n\nNOTAS RECOLECTADAS:\n${items.map((i) => `- ${i.publisher} · ${i.publishedAt ?? "s/f"} · ${i.title} · ${i.url}${i.alreadySeen ? " · (ya la vimos antes)" : ""}`).join("\n")}`,
  });
  if (!s.ok) throw new Error(s.message);
  return {
    brief: tidyBrief(s.value, mission.refs),
    seconds: (Date.now() - started) / 1000,
    costUsd: r.usage.costUsd + s.costUsd,
    webSearches: r.usage.webSearches,
    collected: items.length,
    collectedAlreadySeen: items.filter((i) => i.alreadySeen).length,
    sourcesConsulted: r.sources.length + items.length,
    collectErrors: errors,
  };
}
