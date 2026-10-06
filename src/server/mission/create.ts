import "server-only";

import * as z from "zod/v4";
import { after } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { deepCall } from "./deep";
import { describeMission } from "./state";
import { research } from "./research";
import { mergeDeclared, snapshotStart } from "./context";

// Una misión nueva, en una frase: "Quiero investigar locales comerciales en San Isidro y Zona Norte…". RELEVO
// la convierte en nombre, objetivo, contexto y cómo vigilarla; pregunta solo si falta algo indispensable.
// La estructura del Brain es la misma para todas las misiones: no hay que diseñarla cada vez.

type Db = SupabaseClient<Database>;

export const MissionDraftSchema = z.object({
  name: z.string().describe("Nombre corto y claro (2 a 4 palabras, p. ej. 'Locales Zona Norte')."),
  objective: z.string().describe("Objetivo en una oración, empezando con verbo (p. ej. 'Descubrir y validar oportunidades comerciales y de inversión en San Isidro y alrededores')."),
  context: z.string().describe("Contexto inicial en una línea: zona · rubros · qué tipo de oportunidades (p. ej. 'Zona Norte · locales y comercios · activos · operadores · demanda')."),
  zone: z.string().describe("Zona geográfica principal ('San Isidro y Zona Norte, Buenos Aires'), o '' si no aplica."),
  queries: z.array(z.string()).describe("Entre 3 y 6 búsquedas de noticias para vigilar la misión durante el día (en español, como se buscarían en Google News)."),
  declared: z.array(z.string()).describe("Lo que la persona definió (tamaño, zona, presupuesto, concepto, restricciones), una oración por punto. Es contexto, no evidencia."),
  question: z.string().describe("Solo si sin la respuesta NO se puede empezar a investigar; casi siempre ''. Lo demás se aprende después."),
});
export type MissionDraft = z.infer<typeof MissionDraftSchema>;

const SYSTEM = `Convertís lo que una persona quiere investigar en una misión de RELEVO (un motor que descubre y valida oportunidades de negocio e inversión). Español rioplatense, claro y corto. No inventes datos. No es una entrevista: si se puede empezar a investigar con lo que dijo, no preguntes nada (lo que falte se aprende en el camino).`;

export async function draftMission(db: Db, opts: { workspaceId: string; userId: string; text: string; client?: Pick<Anthropic, "beta"> }) {
  return deepCall(db, { userFacing: true, workspaceId: opts.workspaceId, userId: opts.userId, promptVersion: "mision-alta-v1", system: SYSTEM, prompt: `Lo que quiere investigar:\n${opts.text}`, schema: MissionDraftSchema, client: opts.client, effort: "low" });
}

/** Crea la misión y deja a RELEVO trabajando: estado inicial y un primer panorama en el inicio. */
export async function createMission(db: Db, opts: { workspaceId: string; userId: string; slug: string; settings?: unknown; draft: Omit<MissionDraft, "question" | "declared"> & { declared?: string[] } }): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const d = opts.draft;
  const { data, error } = await db
    .from("campaigns")
    .insert({ workspace_id: opts.workspaceId, name: d.name.trim().slice(0, 120), objective: d.objective.trim().slice(0, 600), zone: d.zone.trim() || null, kind: "mision", status: "activa", watch: { queries: d.queries.slice(0, 8), sites: [], region: d.zone.trim() || null, context: d.context, declared: mergeDeclared([], d.declared ?? [], { by: null }) } as unknown as Json })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  const id = data.id;
  // La foto del comienzo (qué buscábamos y qué creíamos): para poder decir después qué cambió.
  await snapshotStart(db, id).catch(() => null);
  const work = async () => {
    await research(db, { workspaceId: opts.workspaceId, slug: opts.slug, userId: opts.userId, settings: opts.settings, missionId: id, title: `Primer panorama de ${d.name}`, why: "Lo preparé al crear la misión.", question: `Arrancamos la misión "${d.name}": ${d.objective}. Contexto: ${d.context}. Armá un primer panorama: qué está pasando en la zona y el rubro, qué actores y activos conviene conocer, qué hipótesis valdría la pena validar primero y cuál sería el primer paso concreto en la calle.` }).catch(() => null);
    await describeMission(db, { workspaceId: opts.workspaceId, campaignId: id }).catch(() => null);
  };
  try {
    after(work);
  } catch {
    await work();
  }
  return { ok: true, id };
}
