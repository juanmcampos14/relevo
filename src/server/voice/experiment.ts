import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/supabase/database.types";
import { SURVEY_V1, isEligible, isUseful, redactAnswers, type Answers, type SurveyDefinition } from "@/domain/voice/survey";

// Voice of Añelo del lado del servidor. La ruta pública usa el cliente de servicio: todo se valida acá y
// nunca se devuelven datos de otras respuestas. Sin IP guardada: solo un hash que rota por día.

type Db = SupabaseClient<Database>;
type J = NonNullable<Json>;
export const VOICE_SLUG = "voice-anelo";

/** Dos anuncios con la MISMA imagen y distinto texto: la diferencia se atribuye al mensaje. */
export const VOICE_VARIANTS = [
  {
    code: "A", label: "A · experiencia cotidiana",
    primary_text: "¿Vivís o trabajás en Añelo? Queremos conocer cómo resolvés lo cotidiano: comida, traslados, alojamiento y servicios. RELEVO hace un relevamiento privado para entender necesidades reales. Contanos tu experiencia, también si hoy lo resolvés bien.",
    headline: "Tu experiencia en Añelo cuenta", cta: "Más información", what_changes: "Mensaje: experiencia cotidiana (misma imagen que B)",
  },
  {
    code: "B", label: "B · tiempo perdido",
    primary_text: "Conseguir algo, trasladarte o resolver un servicio a veces lleva más tiempo del esperado, y a veces no. Si vivís o trabajás en Añelo, contanos la última vez que te pasó, o si hoy lo resolvés bien. Un relevamiento privado de RELEVO.",
    headline: "¿Dónde se te va el tiempo en Añelo?", cta: "Más información", what_changes: "Mensaje: tiempo perdido (misma imagen que A)",
  },
] as const;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function ensureVoiceExperiment(db: Db, workspaceId: string, campaignId: string | null) {
  let { data: exp } = await db.from("research_experiments").select("id").eq("slug", VOICE_SLUG).maybeSingle();
  if (!exp) {
    const { data, error } = await db
      .from("research_experiments")
      .insert({
        workspace_id: workspaceId, slug: VOICE_SLUG, title: "Voice of Añelo", campaign_id: campaignId,
        purpose: "Escuchar comportamiento real de quienes viven o trabajan en Añelo: soluciones actuales, problemas recurrentes, tiempo, frecuencia y gasto. Exploratorio, no representativo.",
        budget_stage1_usd: 60, budget_cap_usd: 150,
      })
      .select("id")
      .single();
    if (error) throw error;
    exp = data;
  }
  for (const v of VOICE_VARIANTS) {
    await db.from("experiment_variants").upsert({ workspace_id: workspaceId, experiment_id: exp.id, creative_ref: "voice-comun", ...v }, { onConflict: "experiment_id,code", ignoreDuplicates: true });
  }
  const def = JSON.stringify(SURVEY_V1);
  await db.from("survey_versions").upsert({ workspace_id: workspaceId, experiment_id: exp.id, version: SURVEY_V1.version, definition: JSON.parse(def) as J, definition_sha: sha(def) }, { onConflict: "experiment_id,version", ignoreDuplicates: true });
  return exp.id;
}

export type PublicExperiment = {
  id: string; workspace_id: string; slug: string; title: string; status: string; responsible_name: string | null; contact_email: string | null;
  privacy_notice: string | null; retention_days: number; preview_token_hash: string | null; version_id: string; definition: SurveyDefinition; variants: string[];
};

export async function loadPublicExperiment(db: Db, slug: string): Promise<PublicExperiment | null> {
  const { data: e } = await db.from("research_experiments").select("id, workspace_id, slug, title, status, responsible_name, contact_email, privacy_notice, retention_days, preview_token_hash").eq("slug", slug).maybeSingle();
  if (!e) return null;
  const [{ data: v }, { data: vars }] = await Promise.all([
    db.from("survey_versions").select("id, definition").eq("experiment_id", e.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("experiment_variants").select("code").eq("experiment_id", e.id),
  ]);
  if (!v) return null;
  return { ...e, version_id: v.id, definition: v.definition as unknown as SurveyDefinition, variants: (vars ?? []).map((x) => x.code) };
}

export const hashToken = (t: string) => sha(`voice-preview:${t}`);
export function newPreviewToken() {
  const token = randomBytes(18).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Quién puede responder y en qué cohorte. borrador/piloto: solo con el enlace de revisión. */
export function cohortFor(e: Pick<PublicExperiment, "status" | "preview_token_hash">, token: string | null, testMode: boolean): "prueba" | "piloto" | "real" | null {
  const tokenOk = !!token && !!e.preview_token_hash && hashToken(token) === e.preview_token_hash;
  if (e.status === "activo") return tokenOk && testMode ? "prueba" : "real";
  if (e.status === "piloto" && tokenOk) return testMode ? "prueba" : "piloto";
  if (e.status === "borrador" && tokenOk) return "prueba";
  return null;
}

function secret() {
  return process.env.RESEARCH_HASH_SECRET ?? sha(`relevo:${process.env.SUPABASE_SECRET_KEY ?? "local"}`);
}
export const ipHashDay = (ip: string | null, day = new Date().toISOString().slice(0, 10)) => (ip ? sha(`${secret()}:${day}:${ip}`).slice(0, 32) : null);

const MAX_SESSIONS_PER_HOUR = 30;
const deleteAfter = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export const SessionInput = z.object({
  token: z.string().max(100).nullish(),
  test: z.boolean().optional(),
  params: z.string().max(2000),
  referrer: z.string().max(300).nullish(),
  device: z.enum(["movil", "escritorio", "otro"]),
});

export async function createSession(db: Db, e: PublicExperiment, input: z.infer<typeof SessionInput>, ip: string | null, attribution: { attribution: string; variant: string | null; utm: Record<string, string>; meta: Record<string, string | boolean>; flags: string[] }) {
  const cohort = cohortFor(e, input.token ?? null, !!input.test);
  if (!cohort) return { error: "cerrado" as const };
  const ipHash = ipHashDay(ip);
  if (ipHash) {
    const { count } = await db.from("survey_sessions").select("id", { count: "exact", head: true }).eq("experiment_id", e.id).eq("ip_hash_day", ipHash).gte("landing_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= MAX_SESSIONS_PER_HOUR) return { error: "limite" as const };
  }
  const quickTap = Math.random() < 0.5;
  const { data, error } = await db
    .from("survey_sessions")
    .insert({
      workspace_id: e.workspace_id, experiment_id: e.id, version_id: e.version_id, cohort, variant_code: attribution.variant, attribution: attribution.attribution,
      utm: attribution.utm as J, meta: { ...attribution.meta, ...(attribution.flags.length ? { flags: attribution.flags } : {}) } as J,
      referrer_host: input.referrer ?? null, device: input.device, quick_tap_shown: quickTap, ip_hash_day: ipHash, delete_after: deleteAfter(e.retention_days),
    })
    .select("id")
    .single();
  if (error) throw error;
  await db.from("survey_events").insert({ workspace_id: e.workspace_id, session_id: data.id, kind: "vista" });
  return { sessionId: data.id, quickTap, cohort };
}

export const EventInput = z.object({ sessionId: z.uuid(), kind: z.enum(["inicio", "toque", "pregunta", "fuera_de_alcance"]), question: z.string().max(40).nullish(), value: z.string().max(40).nullish() });

export async function recordEvent(db: Db, e: PublicExperiment, input: z.infer<typeof EventInput>) {
  const { data: s } = await db.from("survey_sessions").select("id, started_at, completed_at").eq("id", input.sessionId).eq("experiment_id", e.id).maybeSingle();
  if (!s || s.completed_at) return false;
  const now = new Date().toISOString();
  await db.from("survey_events").insert({ workspace_id: e.workspace_id, session_id: s.id, kind: input.kind, question: input.question ?? null });
  const patch =
    input.kind === "inicio" || input.kind === "toque"
      ? { started_at: s.started_at ?? now, ...(input.kind === "toque" ? { quick_tap: input.value ?? null } : {}) }
      : input.kind === "pregunta"
        ? { last_question: input.question ?? null }
        : { outcome: "fuera_de_alcance" as const, completed_at: now };
  await db.from("survey_sessions").update(patch).eq("id", s.id);
  return true;
}

const AnswerSchema = z.object({
  choice: z.string().max(80).nullish(),
  choices: z.array(z.string().max(80)).max(10).optional(),
  detail: z.string().max(1500).optional(),
  money: z.record(z.string().max(40), z.number().min(0).max(1e9).nullable()).optional(),
  payer: z.string().max(40).nullish(),
  omitted: z.boolean().optional(),
  skipped: z.string().max(60).optional(),
});
export const SubmitInput = z.object({
  sessionId: z.uuid(),
  answers: z.object({ quick_tap: z.string().max(40).nullish(), eligibility: z.string().max(40).nullish(), items: z.record(z.string().max(40), AnswerSchema) }),
  website: z.string().max(200).optional(), // campo trampa: una persona no lo ve ni lo completa
  elapsedMs: z.number().int().min(0).max(24 * 3600_000),
});

/** Opciones válidas por pregunta: una respuesta con valores que no existen en su versión se rechaza. */
export function validateAgainst(def: SurveyDefinition, a: Answers): string | null {
  const byId = new Map(def.questions.map((q) => [q.id, q]));
  for (const [id, ans] of Object.entries(a.items)) {
    const q = byId.get(id);
    if (!q) return `pregunta desconocida: ${id}`;
    const allowed = new Set(q.options.map((o) => o.value));
    if (ans.choice && !allowed.has(ans.choice)) return `opción inválida en ${id}`;
    if (ans.choices?.some((c) => !allowed.has(c))) return `opción inválida en ${id}`;
    const moneyKeys = new Set((q.money ?? []).map((m) => m.key));
    if (Object.keys(ans.money ?? {}).some((k) => !moneyKeys.has(k))) return `monto inválido en ${id}`;
  }
  if (a.quick_tap && !def.quickTap.options.some((o) => o.value === a.quick_tap)) return "toque inválido";
  if (a.eligibility && !def.eligibility.options.some((o) => o.value === a.eligibility)) return "elegibilidad inválida";
  return null;
}

const MIN_ELAPSED_MS = 20_000;

export async function submitResponse(db: Db, e: PublicExperiment, input: z.infer<typeof SubmitInput>) {
  const { data: s } = await db.from("survey_sessions").select("id, cohort, completed_at, ip_hash_day, version_id").eq("id", input.sessionId).eq("experiment_id", e.id).maybeSingle();
  if (!s) return { error: "sesion" as const };
  if (s.completed_at) return { error: "ya_enviada" as const };
  const answers = input.answers as Answers;
  const invalid = validateAgainst(e.definition, answers);
  if (invalid) return { error: "invalida" as const, detail: invalid };
  // Automatizados: campo trampa completo o envío más rápido de lo humanamente posible → se guarda marcado.
  const flagged = input.website ? "campo_trampa" : input.elapsedMs < MIN_ELAPSED_MS ? "demasiado_rapido" : null;
  const { found } = redactAnswers(answers);
  const answersHash = sha(JSON.stringify(answers.items));
  const { data: dup } = s.ip_hash_day
    ? await db.from("survey_responses").select("id, session_id, survey_sessions!inner(ip_hash_day)").eq("experiment_id", e.id).eq("answers_hash", answersHash).eq("survey_sessions.ip_hash_day", s.ip_hash_day).limit(1)
    : { data: [] };
  const code = randomUUID().slice(0, 8).toUpperCase();
  const now = new Date().toISOString();
  const { error } = await db.from("survey_responses").insert({
    workspace_id: e.workspace_id, session_id: s.id, experiment_id: e.id, version_id: s.version_id, cohort: s.cohort,
    answers: answers as unknown as J, answers_hash: answersHash, eligible: isEligible(answers), useful: isUseful(answers), pii_detected: found,
    duplicate_of: dup?.[0]?.id ?? null, review_status: flagged ? "descartada" : "pendiente", review_note: flagged ? `Descartada automáticamente: ${flagged}` : null,
    deletion_code: code, delete_after: deleteAfter(e.retention_days),
  });
  if (error) throw error;
  await db.from("survey_sessions").update({ outcome: "completa", completed_at: now, flagged }).eq("id", s.id);
  await db.from("survey_events").insert({ workspace_id: e.workspace_id, session_id: s.id, kind: "completa" });
  return { ok: true as const, code };
}

/** Borra lo vencido (plazo de conservación). Las respuestas se van con su sesión. */
export async function purgeExpired(db: Db) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db.from("survey_sessions").delete().lt("delete_after", today).select("id");
  return data?.length ?? 0;
}
