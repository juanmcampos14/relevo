import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { GAPS, type Gap } from "@/domain/readiness";
import type { Discovery } from "@/domain/discovery";
import { companyName } from "@/server/entities";
import { deepCall } from "./deep";

// "¿A quién busco en AOG?": plan preparado en background. AOG no es recorrer stands: es resolver preguntas
// de negocio. Por cada objetivo: por qué, qué sabemos, qué queremos descubrir, con quién hablar, qué
// preguntar y qué cambiaría con la respuesta. La conversación responde desde acá en segundos.

type Db = SupabaseClient<Database>;
const PROMPT_VERSION = "mision-aog-v1";

export const AogSchema = z.object({
  opening: z.string().describe("Una oración: qué tiene que resolver la persona en AOG (sin cifras internas ni jerga)."),
  targets: z.array(
    z.object({
      company_ref: z.string().describe("'company:…' de la lista, o \"\" si es un actor que todavía no está en el Brain."),
      name: z.string().describe("Nombre de la empresa u organización."),
      priority: z.number().int().min(1).max(3).describe("1 = buscarla sí o sí."),
      why: z.string().describe("Por qué buscarla: qué pregunta de negocio ayuda a resolver."),
      we_know: z.string().describe("Qué sabemos hoy, breve y con su naturaleza (publicado, declarado, sin validar)."),
      discover: z.string().describe("Qué queremos descubrir con esta conversación."),
      talk_to: z.string().describe("Con quién intentaría hablar: persona de la lista (nombre) o rol (Compras, Procurement, Proyectos…)."),
      contact_ref: z.string().describe("'contact:…' si es una persona de la lista, o \"\"."),
      ask: z.array(z.string()).describe("Hasta 3 preguntas concretas, en el tono del guion si existe."),
      if_answered: z.string().describe("Qué cambiaría si obtenemos la respuesta (qué hipótesis gana o pierde, qué decisión se habilita)."),
      hypothesis_refs: z.array(z.string()).describe("'finding:…' que toca."),
    }),
  ).describe("Entre 5 y 10, por prioridad."),
  not_worth: z.array(z.string()).describe("Hasta 3 tipos de stands o conversaciones que no valen el tiempo en AOG, con el motivo."),
});
export type AogPlan = z.infer<typeof AogSchema> & { computed_at: string };

const SYSTEM = `Preparás AOG Patagonia (19 y 20 de octubre, Neuquén) para un equipo que investiga oportunidades de negocio en Añelo / Vaca Muerta. AOG no es recorrer stands: es resolver preguntas de negocio con quienes compran, pagan, asignan o deciden.
Reglas:
- Priorizá operadoras, contratistas y compradores que pueden validar hipótesis desde el lado demanda; sumá operadores locales solo si cierran un gap que no se cierra en Añelo.
- Usá los guiones existentes cuando haya: sus preguntas ya están pensadas.
- Solo referencias de las listas. No inventes personas ni cargos: si no hay persona, poné el rol a buscar.
- Lenguaje humano, sin jerga interna ni códigos.`;

export async function planAog(db: Db, opts: { workspaceId: string; campaignId: string; client?: Pick<Anthropic, "beta">; userId?: string | null }) {
  const [{ data: scripts }, { data: targets }, { data: findings }] = await Promise.all([
    db.from("research_questions").select("code, industry, dimension, question, next_action").eq("campaign_id", opts.campaignId).ilike("industry", "AOG%").order("code"),
    // Solo personas con relación vigente: a quien dejó la empresa no se lo recomienda.
    db.from("campaign_targets").select("purpose, priority, briefing, companies(id, trade_name, legal_name, sector, contact_links(contacts(id, full_name, role_title)))").eq("campaign_id", opts.campaignId).not("company_id", "is", null).is("companies.contact_links.valid_until", null),
    db.from("findings").select("id, statement, finding_assessments(created_at, gaps, discovery)").eq("campaign_id", opts.campaignId).neq("review_status", "rechazado").eq("case_status", "activo"),
  ]);
  const hyp = (findings ?? []).map((f) => {
    const a = [...f.finding_assessments].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
    return `finding:${f.id} · ${(a?.discovery as Discovery | null)?.belief ?? f.statement} · falta: ${((a?.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.label ?? g).join(", ")}`;
  });
  type B = { why?: string; we_know?: string; we_need?: string; objective?: string };
  const demand = (targets ?? []).filter((t) => t.companies && (t.purpose === "vender_crear" || (t.priority ?? 9) <= 1));
  const lines = demand.map((t) => {
    const c = t.companies!;
    const b = (t.briefing ?? {}) as B;
    const people = c.contact_links.flatMap((l) => (l.contacts ? [`contact:${l.contacts.id} ${l.contacts.full_name}${l.contacts.role_title ? ` (${l.contacts.role_title})` : ""}`] : []));
    return `- company:${c.id} · ${companyName(c)} · ${c.sector ?? ""} · propósito ${t.purpose ?? "—"}${b.why ? ` · por qué: ${b.why}` : ""}${b.we_know ? ` · sabemos: ${b.we_know}` : ""}${b.we_need ? ` · falta: ${b.we_need}` : ""}${people.length ? `\n    personas: ${people.join(" | ")}` : ""}`;
  });
  const prompt = [
    "GUIONES AOG YA ESCRITOS:",
    ...(scripts ?? []).map((q) => `- ${q.industry} · ${q.dimension ?? ""} · ${q.question}${q.next_action ? ` · próximo paso: ${q.next_action}` : ""}`),
    "",
    "HIPÓTESIS (qué creemos · qué falta):",
    ...hyp.map((h) => `- ${h}`),
    "",
    "OBJETIVOS DEL LADO DEMANDA Y PRIORITARIOS (con lo que ya preparó RELEVO):",
    ...lines,
  ].join("\n");
  const allowed = new Set([...prompt.matchAll(/((?:company|contact|finding):[0-9a-f-]{36})/g)].map((m) => m[1]));
  const r = await deepCall(db, { workspaceId: opts.workspaceId, promptVersion: PROMPT_VERSION, system: SYSTEM, prompt, schema: AogSchema, client: opts.client, userId: opts.userId });
  if (!r.ok) return r;
  const plan: AogPlan = {
    ...r.value,
    targets: r.value.targets.slice(0, 10).map((t) => ({
      ...t,
      company_ref: allowed.has(t.company_ref) ? t.company_ref : "",
      contact_ref: allowed.has(t.contact_ref) ? t.contact_ref : "",
      hypothesis_refs: t.hypothesis_refs.filter((h) => allowed.has(h)),
      ask: t.ask.slice(0, 3),
    })),
    not_worth: r.value.not_worth.slice(0, 3),
    computed_at: new Date().toISOString(),
  };
  const { data: c } = await db.from("campaigns").select("synthesis").eq("id", opts.campaignId).single();
  const { error } = await db.from("campaigns").update({ synthesis: { ...((c?.synthesis as object) ?? {}), aog: plan } as unknown as Json }).eq("id", opts.campaignId);
  if (error) return { ok: false as const, message: error.message };
  return { ok: true as const, plan, costUsd: r.costUsd };
}
