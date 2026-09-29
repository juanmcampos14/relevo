import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  DIMENSIONS,
  DIMENSION_KEYS,
  GAPS,
  deterministicGaps,
  gapsFromDimensions,
  metrics,
  orderGaps,
  sanitizeDimensions,
  type EvidenceLink,
  type Gap,
} from "@/domain/readiness";

type Db = SupabaseClient<Database>;
const MODEL = "claude-opus-5-5";
const PROMPT_VERSION = "finding-estado-v2";
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const DAILY_LIMIT = 60;
const GAP_KEYS = Object.keys(GAPS) as [Gap, ...Gap[]];

const AssessmentSchema = z.object({
  summary: z.string().describe("En 1-2 oraciones: en qué estado está esta hipótesis y qué la frena."),
  dimensions: z.array(
    z.object({
      key: z.enum(DIMENSION_KEYS),
      status: z.enum(["sabido", "creido", "contradicho", "falta"]),
      summary: z.string().describe("Qué se sabe o qué falta, en una oración concreta."),
      evidence_ids: z.array(z.string()).describe("ids de la evidencia listada que lo sostiene (o lo contradice)."),
    }),
  ),
  next_validations: z.array(
    z.object({
      title: z.string().describe("Acción de validación concreta con verbo: a quién, qué preguntar o comprobar."),
      why: z.string().describe("Qué incertidumbre reduce y por qué ahora."),
      gap: z.enum(GAP_KEYS),
      who: z.string().nullable().describe("Con quién (persona, rol o tipo de empresa), si se puede decir."),
    }),
  ).describe("Entre 1 y 3, de la más útil a la menos útil."),
});

const SYSTEM = `Evaluás el estado de una hipótesis (finding) de un equipo que investiga oportunidades de negocio en Añelo / Vaca Muerta, a partir de la evidencia vinculada. Tu trabajo es decir qué sabemos, qué creemos, qué lo contradice y qué falta saber, y proponer la validación más útil. Una persona decide.

Estados por dimensión:
- sabido: respaldado por evidencia listada. Que alguien haya DECLARADO algo es un hecho que sabemos, aunque su contenido no esté verificado: formulalo como declaración ("Un encargado de una empresa declaró que mandan 8 camionetas por semana a Neuquén"), nunca como verdad general.
- creido: lo que se deduce o generaliza a partir de esa evidencia y todavía no está validado ("puede ser un problema de varias flotas").
- contradicho: hay evidencia en contra listada.
- falta: no hay información.

Reglas:
- Citá solo ids de la evidencia listada. No inventes datos, empresas ni cifras.
- Un solo caso no alcanza para generalizar: tenelo en cuenta.
- La contraevidencia pesa tanto como la evidencia a favor; si hay, las validaciones deben ayudar a resolverla.
- Un finding no es una oportunidad: no propongas avanzar comercialmente, proponé validar.
- Las validaciones son concretas y realizables en campo o por teléfono (a quién, qué preguntar, qué dato conseguir).
- Español rioplatense, breve.`;

export type AssessResult = { ok: true; assessmentId: string; proposals: number } | { ok: false; message: string };

export async function assessFinding(db: Db, opts: { workspaceId: string; settings: unknown; userId: string; findingId: string; client?: Anthropic; today?: string }): Promise<AssessResult> {
  if ((opts.settings as { ai_processing_consent?: boolean } | null)?.ai_processing_consent !== true) {
    return { ok: false, message: "El workspace no habilitó el procesamiento con IA." };
  }
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, message: "La IA no está configurada en este entorno." };
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).eq("user_id", opts.userId).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, message: `Llegaste al límite de ${DAILY_LIMIT} usos de IA en 24 horas.` };

  const { data: finding } = await db
    .from("findings")
    .select("id, statement, kind, analysis, companies(trade_name, legal_name), finding_evidence(stance, evidence(id, statement, quote, verification_status, origin_kind, observed_at, revalidate_after, company_id, stated_by_contact_id, capture_id, visit_id, source_id, companies(trade_name, legal_name), stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name, role_title)))")
    .eq("id", opts.findingId)
    .maybeSingle();
  if (!finding) return { ok: false, message: "Finding no encontrado." };

  const rows = finding.finding_evidence.filter((fe) => fe.evidence).map((fe) => ({ stance: fe.stance as EvidenceLink["stance"], e: fe.evidence! }));
  const links: EvidenceLink[] = rows.map(({ stance, e }) => ({ id: e.id, stance, verification_status: e.verification_status, revalidate_after: e.revalidate_after, company_id: e.company_id, stated_by_contact_id: e.stated_by_contact_id, capture_id: e.capture_id, visit_id: e.visit_id, source_id: e.source_id }));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const m = metrics(links, today);
  const detGaps = deterministicGaps(m);

  const evidenceText = rows.length
    ? rows.map(({ stance, e }) => [
        `- id ${e.id} · ${stance === "supports" ? "A FAVOR" : stance === "contradicts" ? "EN CONTRA" : "CONTEXTO"}`,
        `  "${e.statement}"${e.quote ? ` (cita: "${e.quote}")` : ""}`,
        `  verificación: ${e.verification_status} · origen: ${e.origin_kind}${e.observed_at ? ` · ${e.observed_at.slice(0, 10)}` : ""}`,
        `  empresa: ${e.companies?.trade_name ?? e.companies?.legal_name ?? "sin identificar"} · dicho por: ${e.stated_by ? `${e.stated_by.full_name}${e.stated_by.role_title ? ` (${e.stated_by.role_title})` : ""}` : "—"}`,
      ].join("\n")).join("\n")
    : "(no hay evidencia vinculada)";
  const prompt = [
    `FINDING: ${finding.statement}`,
    finding.analysis ? `Contexto: ${finding.analysis}` : null,
    finding.companies ? `Empresa: ${finding.companies.trade_name ?? finding.companies.legal_name}` : null,
    "",
    `MÉTRICAS (calculadas, no las cambies): ${m.supports} a favor · ${m.contradicts} en contra · ${m.independentCases} caso(s) independiente(s) · ${m.verified} verificada(s) · ${m.stale} desactualizada(s).`,
    `Faltantes ya detectados: ${detGaps.map((g) => GAPS[g].label).join(", ") || "ninguno"}.`,
    "",
    `DIMENSIONES A EVALUAR: ${DIMENSIONS.map((d) => `${d.key} (${d.label})`).join(", ")}.`,
    "",
    "EVIDENCIA VINCULADA:",
    evidenceText,
  ].filter((x) => x !== null).join("\n");

  const started = Date.now();
  let parsed: z.infer<typeof AssessmentSchema> | null = null;
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let error: string | null = null;
  let status: "ok" | "error" | "refused" = "ok";
  try {
    const client = opts.client ?? new Anthropic();
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(AssessmentSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    usage = { input: res.usage.input_tokens ?? 0, output: res.usage.output_tokens ?? 0, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 };
    if (res.stop_reason === "refusal") {
      status = "refused";
      error = "El modelo no evaluó este finding.";
    } else if (!res.parsed_output) {
      status = "error";
      error = "La respuesta llegó incompleta.";
    } else parsed = res.parsed_output;
  } catch (e) {
    status = "error";
    error = e instanceof Anthropic.RateLimitError ? "Límite de uso del proveedor de IA: reintentá en unos minutos." : e instanceof Anthropic.APIError ? `Error del proveedor de IA (${e.status}).` : "No se pudo evaluar el finding.";
  }

  const cost = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1_000_000;
  const { data: run } = await db
    .from("ai_runs")
    .insert({ workspace_id: opts.workspaceId, user_id: opts.userId, model: MODEL, prompt_version: PROMPT_VERSION, status, input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, cost_usd: Number(cost.toFixed(5)), error, duration_ms: Date.now() - started })
    .select("id")
    .single();
  if (!parsed) return { ok: false, message: error ?? "No se pudo evaluar el finding." };

  const dims = sanitizeDimensions(parsed.dimensions, links);
  const gaps = orderGaps([...detGaps, ...gapsFromDimensions(dims)]);
  const { data: assessment, error: e1 } = await db
    .from("finding_assessments")
    .insert({
      workspace_id: opts.workspaceId,
      finding_id: finding.id,
      evidence_ids: links.map((l) => l.id),
      dimensions: dims as unknown as NonNullable<Json>,
      gaps,
      summary: parsed.summary,
      supports: m.supports,
      contradicts: m.contradicts,
      independent_cases: m.independentCases,
      ai_run_id: run?.id ?? null,
    })
    .select("id")
    .single();
  if (e1) return { ok: false, message: e1.message };

  // Las validaciones anteriores sin decidir se reemplazan; las ya decididas quedan en el historial.
  await db.from("proposals").delete().eq("finding_id", finding.id).eq("status", "propuesta");
  const order = (g: Gap) => (gaps.includes(g) ? gaps.indexOf(g) : 99);
  const validations = [...parsed.next_validations].sort((a, b) => order(a.gap) - order(b.gap)).slice(0, 3);
  if (validations.length) {
    const { error: e2 } = await db.from("proposals").insert(
      validations.map((v, i) => ({
        workspace_id: opts.workspaceId,
        finding_id: finding.id,
        assessment_id: assessment.id,
        kind: "next_action",
        position: i,
        payload: { title: v.title, why: v.why, gap: v.gap, who: v.who } as NonNullable<Json>,
        ai_run_id: run?.id ?? null,
      })),
    );
    if (e2) return { ok: false, message: e2.message };
  }
  return { ok: true, assessmentId: assessment.id, proposals: validations.length };
}
