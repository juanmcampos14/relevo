import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { missionBrief } from "@/server/ai/mission";
import { deepCall, type DeepModel } from "./deep";
import { randomUUID } from "node:crypto";
import { EMPTY_FOCUS, correctionsForBrain, mergeSynthesis, type Focus } from "@/domain/focus";

// "RELEVO ya trabajó": la síntesis diaria de la misión se calcula en background (después del Brief) y la
// conversación responde desde ella en segundos. Lenguaje humano, sin jerga interna; referencias reales.

type Db = SupabaseClient<Database>;
const PROMPT_VERSION = "mision-sintesis-v3";

const Item = z.object({
  title: z.string().describe("Qué haría, con verbo, en lenguaje humano (p. ej. 'Mover las presentaciones con YPF, Vista y Tecpetrol')."),
  why: z.string().describe("Por qué ahora, en una oración."),
  refs: z.array(z.string()).describe("Referencias 'tipo:uuid' del material que lo sostienen (empresas, personas, tareas, hipótesis)."),
  for: z.string().describe("Nombre de quién del equipo debería hacerlo (de equipo_de_la_mision), o '' si puede ser cualquiera."),
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

const SYSTEM = `Sos RELEVO preparando la misión de un equipo que investiga oportunidades de negocio (la zona, el objetivo y las fechas salen del material de la misión). Con el material del Brain, decidís qué haría la persona hoy y esta semana para avanzar la misión.
Reglas:
- Investigamos para cerrar gaps: priorizá lo que abre puertas (presentaciones, eventos del sector), los compromisos que vencen y validar hipótesis desde el lado comprador cuando corresponda.
- Lo importante primero; dejá afuera casi todo. Nada de inventarios ni conteos internos.
- Lenguaje humano. Prohibido: "finding", "gap", "baseline", "evidencia nula", "geolocalizado", "workspace", "memoria", ids o códigos (H-VA-…, AN-…).
- Usá solo referencias que aparezcan en el material. Cada cosa lleva las referencias de las empresas o personas con las que hay que moverse.
- Las correcciones de la persona mandan: lo que sacó o dio por hecho no vuelve; lo que puso primero va primero; lo que pospuso no es de hoy.
- Si hoy hay una sola cosa realmente importante, proponé una sola.
- Si la misión tiene equipo (equipo_de_la_mision), decí de quién es cada movimiento (for) cuando corresponde a alguien en particular; si puede hacerlo cualquiera, dejalo vacío.`;

export async function synthesizeMission(db: Db, opts: { workspaceId: string; campaignId: string; client?: Pick<Anthropic, "beta">; today?: Date; userId?: string | null; model?: DeepModel; dryRun?: boolean }) {
  const brief = await missionBrief(db, opts.campaignId, opts.today, { withSynthesis: false });
  if (!brief) return { ok: false as const, message: "No hay misión" };
  const { data: targets } = await db.from("campaign_targets").select("briefing, companies(id, trade_name, legal_name)").eq("campaign_id", opts.campaignId).not("briefing", "is", null);
  type B = { this_week?: boolean; today?: boolean; why?: string; objective?: string; attention?: string | null; contact?: { ref: string; name: string } | null };
  const shortlist = (targets ?? [])
    .map((t) => ({ company: t.companies, b: t.briefing as B }))
    .filter((t) => t.company && (t.b.this_week || t.b.today))
    .map((t) => ({ company: `company:${t.company!.id}`, name: t.company!.trade_name ?? t.company!.legal_name, contact: t.b.contact ?? null, today: !!t.b.today, why: t.b.why, objective: t.b.objective, attention: t.b.attention }));
  const { data: prev } = await db.from("campaigns").select("synthesis").eq("id", opts.campaignId).single();
  const prevSynthesis = (prev?.synthesis ?? {}) as { aog?: unknown; focus?: Focus };
  const focus = prevSynthesis.focus?.items ? prevSynthesis.focus : EMPTY_FOCUS;
  const now = opts.today ?? new Date();
  const corrections = correctionsForBrain(focus, now);
  const current = focus.items.filter((x) => x.status === "activa" || x.status === "pospuesta").map((x) => ({ title: x.title, status: x.status, until: x.until ?? null, puesta_por_la_persona: x.source === "persona" || !!x.pinned }));
  // Quiénes trabajan en la misión (Ahora es personal: cada movimiento puede ser de alguien).
  const { data: crew } = await db.from("campaign_members").select("user_id, role").eq("campaign_id", opts.campaignId).in("role", ["owner", "member"]);
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", opts.workspaceId).single();
  const team = ((ws?.settings as { team?: Record<string, { short?: string; full?: string }> } | null)?.team) ?? {};
  const { data: profs } = crew?.length ? await db.from("profiles").select("user_id, display_name").in("user_id", crew.map((c) => c.user_id)) : { data: [] };
  const members = (crew ?? []).map((c) => ({ user_id: c.user_id, name: team[c.user_id]?.short ?? profs?.find((p) => p.user_id === c.user_id)?.display_name?.split(/\s+/)[0] ?? "Alguien" }));
  const material = JSON.stringify({ ...brief, shortlist, prioridades_actuales: current, correcciones_de_la_persona: corrections, equipo_de_la_mision: members.length > 1 ? members.map((m) => m.name) : [] });
  const allowed = new Set([...material.matchAll(/"([a-z]+:[0-9a-f-]{36})"/g)].map((m) => m[1]));
  const r = await deepCall(db, { workspaceId: opts.workspaceId, promptVersion: PROMPT_VERSION, system: SYSTEM, prompt: `MATERIAL DEL BRAIN (JSON):\n${material}`, schema: SynthesisSchema, client: opts.client, userId: opts.userId, model: opts.model });
  if (!r.ok) return r;
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m.user_id]));
  const clean = (xs: z.infer<typeof Item>[], n: number) => xs.slice(0, n).map((x) => ({ ...x, refs: x.refs.filter((ref) => allowed.has(ref)), for_user: members.length > 1 ? byName.get(x.for.trim().toLowerCase()) ?? null : null }));
  const synthesis: MissionSynthesis = {
    ...r.value,
    today: clean(r.value.today, 3),
    this_week: clean(r.value.this_week, 4),
    unknowns: r.value.unknowns.slice(0, 3),
    computed_at: new Date().toISOString(),
    counts: { contacts_this_week: shortlist.length, attention_today: shortlist.filter((s) => s.today).length },
  };
  // El plan de AOG y el estado de la misión se preparan aparte y se conservan al renovar la síntesis del día. El foco se actualiza con lo
  // nuevo sin pisar lo que la persona decidió (se relee por si cambió mientras se pensaba).
  if (opts.dryRun) return { ok: true as const, synthesis, costUsd: r.costUsd };
  const { data: latest } = await db.from("campaigns").select("synthesis").eq("id", opts.campaignId).single();
  const keep = (latest?.synthesis ?? {}) as { aog?: unknown; focus?: Focus; state?: unknown };
  const merged = mergeSynthesis(keep.focus?.items ? keep.focus : EMPTY_FOCUS, { today: synthesis.today, week: synthesis.this_week }, new Date(), randomUUID);
  const { error } = await db.from("campaigns").update({ synthesis: { ...synthesis, ...(keep.aog ? { aog: keep.aog } : {}), ...(keep.state ? { state: keep.state } : {}), focus: merged } as unknown as Json, synthesized_at: synthesis.computed_at }).eq("id", opts.campaignId);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, synthesis, costUsd: r.costUsd };
}
