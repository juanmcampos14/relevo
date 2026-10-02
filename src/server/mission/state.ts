import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { missionBrief } from "@/server/ai/mission";
import { deepCall } from "./deep";

// Estado de la misión: lo que RELEVO ya sabe, contado como lo contaría alguien del equipo. Recupera el valor
// del CRM sin el CRM: qué estamos intentando conseguir, dónde estamos, qué creemos por frente y con qué
// evidencia, qué no sabemos, qué descartamos, quiénes importan y cuáles son los próximos días. Se prepara en
// background (con la síntesis del día) y la Surface lo muestra en segundos.

type Db = SupabaseClient<Database>;
const PROMPT_VERSION = "mision-estado-v3";

export const StateSchema = z.object({
  purpose: z.string().describe("Qué estamos intentando conseguir, en una oración (p. ej. 'Descubrir y validar oportunidades de negocio e inversión alrededor del crecimiento de Vaca Muerta')."),
  stage: z.string().describe("Dónde estamos hoy, en una oración corta (p. ej. 'Research previo y preparación de la primera etapa de terreno')."),
  thesis: z.string().describe("La tesis de trabajo en dos oraciones como mucho, en lenguaje simple."),
  fronts: z.array(z.object({
    name: z.string().describe("Nombre corto del frente (p. ej. 'Housing y alojamiento', 'Viandas', 'Abastecimiento industrial')."),
    believe: z.string().describe("Qué creemos en este frente, en una oración."),
    know: z.string().describe("Qué sabemos de verdad y con qué tan firme (solo idea nuestra / una señal / varias declaraciones / casos verificados), en una oración."),
    missing: z.string().describe("Qué falta para decidir, en una oración."),
    needs_field: z.boolean().describe("¿Se resuelve sí o sí en terreno?"),
    actors: z.array(z.string()).describe("Hasta 4 empresas o personas clave de este frente, por nombre (solo del material)."),
    refs: z.array(z.string()).describe("Referencias 'finding:…' o 'company:…' del material que lo sostienen."),
  })).describe("Entre 4 y 7 frentes, del que tiene más en juego al que menos."),
  unknowns: z.array(z.string()).describe("Hasta 4 cosas importantes que todavía no sabemos."),
  discarded: z.array(z.string()).describe("Lo que ya descartamos o perdió fuerza, con el motivo en pocas palabras. Vacío si no hay nada."),
  next_days: z.array(z.object({ when: z.string().describe("Fecha o rango legible ('12–15 oct')."), what: z.string().describe("Qué pasa, en pocas palabras.") })).describe("Las próximas etapas de la misión según el plan."),
  changed: z.array(z.string()).describe("Hasta 3 cosas que cambiaron esta semana y por qué importan. Vacío si nada importante."),
  questions: z.array(z.string()).describe("4 preguntas que la persona podría hacerle a RELEVO sobre la misión, en su voz (p. ej. '¿Qué sabemos de housing?')."),
  story: z.string().describe("Para alguien que se suma hoy a la misión: 3 a 5 oraciones narrativas, sin cifras de inventario. Qué estamos haciendo y por qué; dónde estamos (cuánto es mapeo y cuánto validación propia); qué es lo importante ahora; qué cambió desde que empezamos y qué sigue sin validar."),
  you_can_help: z.array(z.string()).describe("Hasta 3 lugares concretos donde alguien que se suma (con su contexto, relaciones o conocimiento) puede acelerar la misión ahora, en una oración cada uno."),
  searching: z.array(z.string()).describe("Lo que buscamos, según lo que definió el equipo (contexto declarado: tamaño, zona, presupuesto, concepto, restricciones), en pocas líneas. Es contexto, no evidencia. Vacío si no hay."),
  since_start: z.object({
    believed: z.string().describe("Qué creíamos/buscábamos al empezar la misión (de la foto del comienzo), en una oración."),
    found: z.string().describe("Qué encontramos desde entonces (evidencia y señales reales, no lo que dijo el equipo); '' si todavía nada."),
    learned: z.string().describe("Qué cambió: qué se confirma, qué se contradice y qué seguimos sin saber; '' si todavía nada."),
    next: z.string().describe("Qué haría ahora, en una oración."),
  }),
});
export type MissionState = z.infer<typeof StateSchema> & { computed_at: string };

const SYSTEM = `Sos RELEVO contando el estado de una misión de investigación de oportunidades de negocio a alguien del equipo que la abre sin contexto (puede ser un socio que nunca vio el sistema). Con el plan de la misión y lo que el Brain sabe, escribís en lenguaje humano, corto y claro.
Reglas:
- Hipótesis no es oportunidad: una hipótesis es lo que creemos; solo hay oportunidad cuando la evidencia justifica mover algo. Decí con honestidad cuán firme es cada cosa; "por ahora es una idea nuestra" es un estado válido.
- Agrupá por frentes de negocio (los del plan), no por tablas. Nada de códigos (H-VA-…, V09), ids, "finding", "gap", "baseline", "workspace", nombres de campos ni de herramientas.
- Separá lo publicado de lo declarado y de lo verificado sin jerga ("lo dijo un encargado", "lo publicó un portal").
- Solo nombres y referencias que estén en el material.
- Lo que el equipo definió (contexto declarado: lo que busca, su presupuesto, su concepto) NO es evidencia: va en searching. "Lo que sabemos" y "found" son solo hechos del mundo.
- since_start compara la foto del comienzo con lo que apareció después: decí con honestidad si todavía no apareció nada.`;

export async function describeMission(db: Db, opts: { workspaceId: string; campaignId: string; client?: Pick<Anthropic, "beta">; userId?: string | null }) {
  const brief = await missionBrief(db, opts.campaignId, new Date(), { withSynthesis: false });
  if (!brief) return { ok: false as const, message: "No hay misión" };
  const [{ data: docs }, { data: dropped }, { data: findings }] = await Promise.all([
    db.from("context_documents").select("title, kind, body").eq("status", "vigente").or(`campaign_id.eq.${opts.campaignId},campaign_id.is.null`),
    db.from("findings").select("statement, review_note, case_status, review_status").eq("campaign_id", opts.campaignId).or("case_status.neq.activo,review_status.eq.rechazado").limit(20),
    db.from("findings").select("id, statement, verticals(name)").eq("campaign_id", opts.campaignId).eq("case_status", "activo").neq("review_status", "rechazado").limit(80),
  ]);
  const { data: camp } = await db.from("campaigns").select("watch").eq("id", opts.campaignId).single();
  const watch = (camp?.watch ?? null) as { declared?: unknown[]; initial?: unknown } | null;
  const material = JSON.stringify({
    plan: (docs ?? []).map((d) => ({ title: d.title, kind: d.kind, body: (d.body ?? "").slice(0, 9000) })),
    frente_de_cada_hipotesis: (findings ?? []).map((f) => ({ ref: `finding:${f.id}`, statement: f.statement, vertical: f.verticals?.name ?? null })),
    descartado: dropped ?? [],
    contexto_declarado_por_el_equipo: ((watch?.declared ?? []) as { text: string }[]).map((d) => d.text),
    foto_del_comienzo: watch?.initial ?? null,
    brain: brief,
  });
  const allowed = new Set([...material.matchAll(/"([a-z]+:[0-9a-f-]{36})"/g)].map((m) => m[1]));
  const r = await deepCall(db, { workspaceId: opts.workspaceId, promptVersion: PROMPT_VERSION, system: SYSTEM, prompt: `MATERIAL (JSON):\n${material}`, schema: StateSchema, client: opts.client, userId: opts.userId });
  if (!r.ok) return r;
  const state: MissionState = {
    ...r.value,
    fronts: r.value.fronts.slice(0, 7).map((f) => ({ ...f, actors: f.actors.slice(0, 4), refs: f.refs.filter((x) => allowed.has(x)) })),
    unknowns: r.value.unknowns.slice(0, 4),
    changed: r.value.changed.slice(0, 3),
    questions: r.value.questions.slice(0, 4),
    computed_at: new Date().toISOString(),
  };
  const { data: latest } = await db.from("campaigns").select("synthesis").eq("id", opts.campaignId).single();
  const { error } = await db.from("campaigns").update({ synthesis: { ...((latest?.synthesis ?? {}) as object), state } as unknown as Json }).eq("id", opts.campaignId);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, state, costUsd: r.costUsd };
}
