import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { missionBrief } from "@/server/ai/mission";
import { deepCall } from "./deep";

// "RELEVO ya trabajó": la síntesis diaria de la misión se calcula en background (después del Brief) y la
// conversación responde desde ella en segundos. Lenguaje humano, sin jerga interna; referencias reales.

type Db = SupabaseClient<Database>;
const PROMPT_VERSION = "mision-sintesis-v1";

const Item = z.object({
  title: z.string().describe("Qué haría, con verbo, en lenguaje humano (p. ej. 'Mover las presentaciones con YPF, Vista y Tecpetrol')."),
  why: z.string().describe("Por qué ahora, en una oración."),
  refs: z.array(z.string()).describe("Referencias 'tipo:uuid' del material que lo sostienen (empresas, personas, tareas, hipótesis)."),
});
export const SynthesisSchema = z.object({
  opening: z.string().describe("Una oración de apertura que diga cuántas cosas haría hoy y para qué (sin saludo, sin nombre, sin cifras internas)."),
  today: z.array(Item).describe("Entre 1 y 3 cosas para hoy, de la más importante a la menos."),
  this_week: z.array(Item).describe("Hasta 4 cosas para esta semana que no son de hoy."),
  unknowns: z.array(z.string()).describe("Hasta 3 cosas que todavía no sabemos y conviene resolver antes de viajar, en lenguaje humano."),
  question: z.string().describe("La pregunta con la que cerrarías para que la persona elija por dónde arrancar."),
  action_label: z.string().describe("Etiqueta corta del botón de la acción principal (2 a 4 palabras, p. ej. 'Mover contactos')."),
});
export type MissionSynthesis = z.infer<typeof SynthesisSchema> & { computed_at: string; counts: { contacts_this_week: number; attention_today: number } };

const SYSTEM = `Sos RELEVO preparando la misión de campo de un equipo que investiga oportunidades de negocio en Añelo / Vaca Muerta. Con el material del Brain, decidís qué haría la persona hoy y esta semana para preparar el viaje.
Reglas:
- Investigamos para cerrar gaps: priorizá lo que abre puertas (presentaciones, AOG), los compromisos que vencen y validar hipótesis desde el lado comprador cuando corresponda.
- Lo importante primero; dejá afuera casi todo. Nada de inventarios ni conteos internos.
- Lenguaje humano. Prohibido: "finding", "gap", "baseline", "evidencia nula", "geolocalizado", "workspace", "memoria", ids o códigos (H-VA-…, AN-…).
- Usá solo referencias que aparezcan en el material.`;

export async function synthesizeMission(db: Db, opts: { workspaceId: string; campaignId: string; client?: Pick<Anthropic, "beta">; today?: Date }) {
  const brief = await missionBrief(db, opts.campaignId, opts.today, { withSynthesis: false });
  if (!brief) return { ok: false as const, message: "No hay misión" };
  const { data: targets } = await db.from("campaign_targets").select("briefing, companies(id, trade_name, legal_name)").eq("campaign_id", opts.campaignId).not("briefing", "is", null);
  type B = { this_week?: boolean; today?: boolean; why?: string; objective?: string; attention?: string | null; contact?: { ref: string; name: string } | null };
  const shortlist = (targets ?? [])
    .map((t) => ({ company: t.companies, b: t.briefing as B }))
    .filter((t) => t.company && (t.b.this_week || t.b.today))
    .map((t) => ({ company: `company:${t.company!.id}`, name: t.company!.trade_name ?? t.company!.legal_name, contact: t.b.contact ?? null, today: !!t.b.today, why: t.b.why, objective: t.b.objective, attention: t.b.attention }));
  const material = JSON.stringify({ ...brief, shortlist });
  const allowed = new Set([...material.matchAll(/"([a-z]+:[0-9a-f-]{36})"/g)].map((m) => m[1]));
  const r = await deepCall(db, { workspaceId: opts.workspaceId, promptVersion: PROMPT_VERSION, system: SYSTEM, prompt: `MATERIAL DEL BRAIN (JSON):\n${material}`, schema: SynthesisSchema, client: opts.client });
  if (!r.ok) return r;
  const clean = (xs: z.infer<typeof Item>[], n: number) => xs.slice(0, n).map((x) => ({ ...x, refs: x.refs.filter((ref) => allowed.has(ref)) }));
  const synthesis: MissionSynthesis = {
    ...r.value,
    today: clean(r.value.today, 3),
    this_week: clean(r.value.this_week, 4),
    unknowns: r.value.unknowns.slice(0, 3),
    computed_at: new Date().toISOString(),
    counts: { contacts_this_week: shortlist.length, attention_today: shortlist.filter((s) => s.today).length },
  };
  const { error } = await db.from("campaigns").update({ synthesis: synthesis as unknown as Json, synthesized_at: synthesis.computed_at }).eq("id", opts.campaignId);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, synthesis, costUsd: r.costUsd };
}
