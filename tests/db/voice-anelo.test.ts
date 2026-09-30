// Voice of Añelo: ruta pública cerrada salvo enlace o activo, sesiones con límite, envío validado,
// duplicados, datos personales, acceso restringido, CSV sin duplicar gasto y borrado por plazo.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { parseAttribution, type Answers } from "@/domain/voice/survey";
import { cohortFor, createSession, ensureVoiceExperiment, hashToken, loadPublicExperiment, purgeExpired, recordEvent, submitResponse, type PublicExperiment } from "@/server/voice/experiment";
import { importMetaCsv, loadDashboard } from "@/server/voice/admin";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, expId: string, e: PublicExperiment;
const users: { id: string; email: string }[] = [];
let ownerDb: SupabaseClient<Database>, memberDb: SupabaseClient<Database>;
const TOKEN = "revision-123";

async function signIn(role: "owner" | "member") {
  const email = `${role}-voice-${randomUUID().slice(0, 8)}@test.local`;
  const password = randomUUID();
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  users.push({ id: data.user!.id, email });
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)`, [ws, data.user!.id, role]);
  const db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password });
  return db;
}

const full = (extra: Partial<Answers["items"]> = {}): Answers => ({
  quick_tap: "comida",
  items: {
    exposicion: { choice: "16_30" }, vinculo: { choices: ["trabajo_por_diagrama_rotacion"] }, actividad: { choice: "tecnico" },
    friccion_comida: { choice: "2_3", detail: "Salí del turno a las 23 y no había nada. Escribime a pepe@mail.com", money: { gasto_extra: 9000 } },
    compra_fuera: { choice: "ninguno" }, frecuencia_fuera: { omitted: true, skipped: "sin_episodio_fuera" }, ...extra,
  },
});
const session = (ip = "10.0.0.1", params = "utm_source=meta&v=A&aid=120211") =>
  createSession(admin, e, { token: TOKEN, params, device: "movil" }, ip, parseAttribution(new URLSearchParams(params), null, e.variants));

beforeAll(async () => {
  ws = await createWorkspace(pool, "Voice");
  await pool.query(`delete from research_experiments where slug = 'voice-anelo'`);
  expId = await ensureVoiceExperiment(admin, ws, null);
  await pool.query(`update research_experiments set preview_token_hash = $2 where id = $1`, [expId, hashToken(TOKEN)]);
  e = (await loadPublicExperiment(admin, "voice-anelo"))!;
  ownerDb = await signIn("owner");
  memberDb = await signIn("member");
});
afterAll(async () => {
  await pool.query(`delete from research_experiments where id = $1`, [expId]);
  await cleanup(pool, [ws], users);
  await pool.end();
});

describe("acceso", () => {
  it("borrador: cerrado al público, abierto como prueba con el enlace de revisión", () => {
    expect(cohortFor(e, null, false)).toBeNull();
    expect(cohortFor(e, "otro", false)).toBeNull();
    expect(cohortFor(e, TOKEN, false)).toBe("prueba");
    expect(cohortFor({ ...e, status: "piloto" }, TOKEN, false)).toBe("piloto");
    expect(cohortFor({ ...e, status: "activo" }, null, false)).toBe("real");
    expect(cohortFor({ ...e, status: "cerrado" }, TOKEN, false)).toBeNull();
  });
});

describe("respuesta completa", () => {
  let sid: string;
  it("sesión con atribución y variante; eventos del embudo", async () => {
    const s = await session();
    if ("error" in s) throw new Error(s.error);
    sid = s.sessionId;
    expect(await recordEvent(admin, e, { sessionId: sid, kind: "toque", value: "comida" })).toBe(true);
    await recordEvent(admin, e, { sessionId: sid, kind: "pregunta", question: "friccion_comida" });
    const { rows } = await pool.query(`select cohort, variant_code, attribution, started_at is not null as started, quick_tap, ip_hash_day from survey_sessions where id = $1`, [sid]);
    expect(rows[0]).toMatchObject({ cohort: "prueba", variant_code: "A", attribution: "meta", started: true, quick_tap: "comida" });
    expect(rows[0].ip_hash_day).not.toContain("10.0.0.1");
  });

  it("rechaza opciones que no existen en la versión; acepta la válida y detecta datos personales", async () => {
    expect(await submitResponse(admin, e, { sessionId: sid, answers: { items: { exposicion: { choice: "mil" } } }, elapsedMs: 60_000 })).toMatchObject({ error: "invalida" });
    const ok = await submitResponse(admin, e, { sessionId: sid, answers: full(), elapsedMs: 90_000 });
    expect(ok).toMatchObject({ ok: true });
    const { rows } = await pool.query(`select eligible, useful, pii_detected, review_status, cohort from survey_responses where session_id = $1`, [sid]);
    expect(rows[0]).toEqual({ eligible: true, useful: true, pii_detected: true, review_status: "pendiente", cohort: "prueba" });
    expect(await submitResponse(admin, e, { sessionId: sid, answers: full(), elapsedMs: 90_000 })).toMatchObject({ error: "ya_enviada" });
  });

  it("mismo contenido desde la misma IP el mismo día = posible duplicado; campo trampa = descartada", async () => {
    const s2 = await session();
    if ("error" in s2) throw new Error(s2.error);
    await submitResponse(admin, e, { sessionId: s2.sessionId, answers: full(), elapsedMs: 90_000 });
    const { rows } = await pool.query(`select duplicate_of is not null as dup from survey_responses where session_id = $1`, [s2.sessionId]);
    expect(rows[0].dup).toBe(true);
    const bot = await session("10.0.0.9");
    if ("error" in bot) throw new Error(bot.error);
    await submitResponse(admin, e, { sessionId: bot.sessionId, answers: full(), website: "http://spam", elapsedMs: 900 });
    const { rows: b } = await pool.query(`select r.review_status, s.flagged from survey_responses r join survey_sessions s on s.id = r.session_id where r.session_id = $1`, [bot.sessionId]);
    expect(b[0]).toEqual({ review_status: "descartada", flagged: "campo_trampa" });
  });

  it("solo owner/admin ven sesiones y respuestas; un miembro no", async () => {
    const { data: asMember } = await memberDb.from("survey_responses").select("id").eq("experiment_id", expId);
    expect(asMember).toEqual([]);
    const { data: asOwner } = await ownerDb.from("survey_responses").select("id").eq("experiment_id", expId);
    expect(asOwner!.length).toBe(3);
    const dash = await loadDashboard(ownerDb, expId, e.definition, ["prueba"]);
    expect(dash.funnelAll.map((x) => [x.key, x.n])).toEqual([["visitas", 2], ["inicios", 1], ["completas", 2], ["elegibles", 2], ["utiles", 2]]);
    expect(dash.flagged).toBe(1);
  });
});

describe("límites y conservación", () => {
  it("más de 30 sesiones por hora desde la misma IP se frenan", async () => {
    for (let i = 0; i < 30; i++) await session("10.9.9.9", "");
    expect(await session("10.9.9.9", "")).toMatchObject({ error: "limite" });
  });
  it("sin parámetros de origen: desconocido (no se inventa)", async () => {
    const s = await session("10.1.1.1", "");
    if ("error" in s) throw new Error(s.error);
    const { rows } = await pool.query(`select attribution, variant_code from survey_sessions where id = $1`, [s.sessionId]);
    expect(rows[0]).toEqual({ attribution: "desconocido", variant_code: null });
  });
  it("lo vencido se borra con su respuesta", async () => {
    await pool.query(`update survey_sessions set delete_after = current_date - 1 where experiment_id = $1 and ip_hash_day is not null`, [expId]);
    expect(await purgeExpired(admin)).toBeGreaterThan(0);
    const { rows } = await pool.query(`select count(*)::int as n from survey_responses where experiment_id = $1`, [expId]);
    expect(rows[0].n).toBe(0);
  });
});

describe("CSV de Meta", () => {
  it("cruza por Ad ID, informa lo que no cruza y reimportar no duplica gasto", async () => {
    await pool.query(`update experiment_variants set meta_ad_id = '120211' where experiment_id = $1 and code = 'A'`, [expId]);
    const csv = '"Day","Campaign ID","Ad set ID","Ad ID","Ad name","Amount spent (USD)","Impressions","Link clicks","Landing page views"\n2026-10-06,1,2,120211,A,7.50,1000,40,30\n2026-10-06,1,2,999999,Otro,1.00,10,1,1\n';
    const r1 = await importMetaCsv(ownerDb, ws, expId, "meta.csv", csv);
    expect(r1).toMatchObject({ applied: 2, unmatched: ["999999 (Otro)"], currency: "USD" });
    await importMetaCsv(ownerDb, ws, expId, "meta-v2.csv", csv.replace("7.50", "8.00"));
    const { rows } = await pool.query(`select sum(spend)::numeric as spend, count(*)::int as n from ad_metrics_daily where experiment_id = $1 and meta_ad_id = '120211'`, [expId]);
    expect(rows[0]).toEqual({ spend: "8.00", n: 1 });
    const { rows: imp } = await pool.query(`select count(*)::int as n from ad_metric_imports where experiment_id = $1`, [expId]);
    expect(imp[0].n).toBe(2);
  });
});
