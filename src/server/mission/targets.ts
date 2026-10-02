import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { PURPOSE_KEYS, type Discovery, type Purpose } from "@/domain/discovery";
import { GAPS, type Gap } from "@/domain/readiness";
import { companyName } from "@/server/entities";
import { deepCall } from "./deep";

// Por qué importa cada objetivo de la misión (trabajo profundo, en background): propósito, hipótesis que
// toca, la persona a quien escribirle, qué sabemos, qué necesitamos y el objetivo del contacto. RELEVO hace
// el primer trabajo; el usuario corrige excepciones. El propósito que ya definió una persona no se pisa.

type Db = SupabaseClient<Database>;
const PROMPT_VERSION = "mision-objetivos-v1";
const CHUNK = 12;

const TargetSchema = z.object({
  targets: z.array(
    z.object({
      target_id: z.string(),
      purpose: z.enum(PURPOSE_KEYS).describe("Qué representa el actor para la misión. comprar_asociar: dueño u operador de un negocio, activo, alojamiento o servicio. vender_crear: quien compra, paga, asigna o decide (operadoras, contratistas, compradores corporativos). inteligencia: brokers, asesores, cámaras, medios, gente que explica cómo funciona la zona."),
      why: z.string().describe("Por qué importa para la misión, en una oración humana."),
      hypothesis_refs: z.array(z.string()).describe("'finding:…' de la lista que este actor ayuda a validar."),
      contact_ref: z.string().describe("'contact:…' de la persona a quien conviene escribirle (de su lista), o \"\" si no hay."),
      we_know: z.string().describe("Qué sabemos hoy, breve. Si no sabemos nada, decilo."),
      we_need: z.string().describe("Qué necesitamos saber de este actor."),
      objective: z.string().describe("Objetivo del contacto, concreto (p. ej. identificar necesidad + comprador)."),
      this_week: z.boolean().describe("true si conviene moverlo esta semana para preparar la misión (cierra un gap importante, tiene follow-up cercano, borrador listo o es una puerta para un evento de la misión)."),
      today: z.boolean().describe("true solo si requiere atención hoy (follow-up que vence hoy o vencido, o un compromiso con fecha)."),
      attention: z.string().describe("Si today o this_week: por qué, en pocas palabras. Si no, \"\"."),
    }),
  ),
});

const SYSTEM = `Preparás la misión de un equipo que investiga oportunidades de negocio (la zona y el objetivo salen de la misión). Para cada objetivo (empresa) decidís para qué nos sirve en esta misión y qué deberíamos lograr con el contacto.
Reglas:
- Investigamos para cerrar gaps: un contacto vale por las hipótesis que ayuda a validar y por el gap que cierra.
- Usá solo ids de las listas. No inventes personas, cargos ni datos.
- Si el objetivo trae "propósito definido", respetalo.
- this_week: como mucho uno de cada cuatro objetivos; priorizá puertas para eventos del sector, follow-ups cercanos, borradores listos y hipótesis con más en juego. today: solo con un vencimiento o compromiso de hoy o vencido.
- Español rioplatense, breve, sin jerga interna (nada de "finding", "gap", "baseline").`;

export async function briefTargets(db: Db, opts: { workspaceId: string; campaignId: string; client?: Pick<Anthropic, "beta">; today?: Date; only?: string[] }) {
  const today = opts.today ?? new Date();
  const day = today.toISOString().slice(0, 10);
  const [{ data: mission }, { data: targets }, { data: findings }] = await Promise.all([
    db.from("campaigns").select("name, starts_on, ends_on").eq("id", opts.campaignId).single(),
    db.from("campaign_targets").select("id, priority, status, purpose, next_action, next_action_due, companies(id, trade_name, legal_name, sector, activity, locality, notes, contact_links(contacts(id, full_name, role_title, contact_kind, relationship_status, outreach_draft)), finding_companies(finding_id)), tasks(title, status, due_on)").eq("campaign_id", opts.campaignId).not("company_id", "is", null).is("companies.contact_links.valid_until", null),
    db.from("findings").select("id, dedup_key, statement, finding_assessments(created_at, gaps, discovery)").eq("campaign_id", opts.campaignId).neq("review_status", "rechazado").eq("case_status", "activo"),
  ]);
  const hyps = (findings ?? []).map((f) => {
    const a = [...f.finding_assessments].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
    const d = a?.discovery as Discovery | null;
    return { ref: `finding:${f.id}`, line: `finding:${f.id} · ${f.dedup_key?.replace(/^crm:/, "") ?? ""} · ${d?.belief ?? f.statement} · evidencia ${d?.evidence_level ?? "sin analizar"} · falta: ${((a?.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.label ?? g).join(", ") || "—"}` };
  });
  const hypRefs = new Set(hyps.map((h) => h.ref));
  const list = (targets ?? []).filter((t) => t.companies && (!opts.only || opts.only.includes(t.id)));
  const result = { briefed: 0, purposesSet: 0, thisWeek: 0, today: 0, costUsd: 0, errors: [] as string[] };

  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const lines = chunk.map((t) => {
      const c = t.companies!;
      const people = c.contact_links.flatMap((l) => (l.contacts ? [l.contacts] : []));
      const open = t.tasks.filter((k) => k.status !== "done").map((k) => `${k.title} (vence ${k.due_on ?? "s/f"})`);
      return [
        `OBJETIVO target_id=${t.id} · ${companyName(c)} · ${[c.sector, c.activity, c.locality].filter(Boolean).join(" · ")} · prioridad ${t.priority ?? "—"} · etapa ${t.status}${t.purpose ? ` · propósito definido: ${t.purpose}` : ""}`,
        t.next_action ? `  próxima acción: ${t.next_action}${t.next_action_due ? ` (${t.next_action_due})` : ""}` : null,
        c.notes ? `  notas: ${c.notes.slice(0, 300)}` : null,
        ...people.map((p) => `  persona contact:${p.id} · ${p.full_name}${p.role_title ? ` (${p.role_title})` : ""} · ${p.contact_kind === "canal_institucional" ? "canal institucional" : "persona"} · relación ${p.relationship_status ?? "—"}${p.outreach_draft ? " · borrador de primer contacto listo" : ""}`),
        c.finding_companies.length ? `  hipótesis vinculadas: ${c.finding_companies.map((x) => `finding:${x.finding_id}`).join(", ")}` : null,
        open.length ? `  pendientes: ${open.slice(0, 3).join(" · ")}` : null,
      ].filter(Boolean).join("\n");
    });
    const prompt = [
      `MISIÓN: ${mission?.name} · ${mission?.starts_on} → ${mission?.ends_on} · hoy ${day}.`,
      "",
      "HIPÓTESIS (qué creemos · evidencia · qué falta):",
      ...hyps.map((h) => `- ${h.line}`),
      "",
      "OBJETIVOS:",
      ...lines,
    ].join("\n");
    const r = await deepCall(db, { workspaceId: opts.workspaceId, promptVersion: PROMPT_VERSION, system: SYSTEM, prompt, schema: TargetSchema, client: opts.client });
    if (!r.ok) {
      result.errors.push(r.message);
      continue;
    }
    result.costUsd += r.costUsd;
    for (const out of r.value.targets) {
      const t = chunk.find((x) => x.id === out.target_id);
      if (!t) continue;
      const people = new Map<string, string>(t.companies!.contact_links.flatMap((l) => (l.contacts ? [[`contact:${l.contacts.id}`, l.contacts.full_name] as [string, string]] : [])));
      const purpose: Purpose = (t.purpose as Purpose | null) ?? out.purpose;
      const briefing = {
        purpose,
        purpose_source: t.purpose ? "persona" : "relevo",
        why: out.why.trim(),
        hypotheses: [...new Set(out.hypothesis_refs.filter((h) => hypRefs.has(h)))].slice(0, 4),
        contact: people.has(out.contact_ref) ? { ref: out.contact_ref, name: people.get(out.contact_ref)! } : null,
        we_know: out.we_know.trim(),
        we_need: out.we_need.trim(),
        objective: out.objective.trim(),
        this_week: out.this_week,
        today: out.today,
        attention: out.attention.trim() || null,
        run_id: r.runId,
      };
      const { error } = await db.from("campaign_targets").update({ briefing: briefing as unknown as Json, briefed_at: new Date().toISOString(), ...(t.purpose ? {} : { purpose }) }).eq("id", t.id);
      if (error) {
        result.errors.push(error.message);
        continue;
      }
      result.briefed++;
      if (!t.purpose) result.purposesSet++;
      if (out.this_week) result.thisWeek++;
      if (out.today) result.today++;
    }
  }
  return result;
}
