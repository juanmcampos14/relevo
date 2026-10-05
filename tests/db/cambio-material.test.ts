// Cambio material: una sola definición gobierna la síntesis, Avanzar, el pulso, "Desde tu última visita", la
// deduplicación de señales y el Morning Brief. Contra Postgres real, con RLS (Tano owner, Fran puede
// trabajar, Jenny fuera de la misión). La IA es falsa: se cuenta cuántas veces se la llama.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { MissionBrief } from "@/domain/brief/mission-brief";
import { synthesizeMission } from "@/server/mission/synthesis";
import { pulse } from "@/server/mission/pulse";
import { materialSince } from "@/server/mission/material";
import { moveServes } from "@/server/mission/changes";
import { catchUp } from "@/server/mission/catch-up";
import { briefMissionId, briefRecipients, dedupeMissionBrief, saveMissionBrief } from "@/server/brief/mission-brief";
import { ensureTodayBrief } from "@/server/brief/pipeline";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const pw = randomUUID();
const tag = randomUUID().slice(0, 8);
const people = { tano: `tano-${tag}@test.local`, fran: `fran-${tag}@test.local`, jenny: `jenny-${tag}@test.local` };
type Who = keyof typeof people;
let ws: string, vm: string, company: string, ids: Record<Who, string>, db: Record<Who, SupabaseClient<Database>>;

/** IA falsa: devuelve `out` y cuenta llamadas (y guarda el último prompt). */
function fakeAI(out: unknown) {
  const calls: string[] = [];
  const client = { beta: { messages: { parse: async (req: { messages: { content: string }[] }) => { calls.push(req.messages[0].content); return { stop_reason: "end_turn", parsed_output: out, usage: { input_tokens: 1, output_tokens: 1 } }; } } } } as unknown as Anthropic;
  return { client, calls };
}
const SYNTH = (changed: string) => ({ opening: "Hoy haría una cosa.", today: [{ title: "Hablar con Martín de El Pampita", why: "Antes de AOG.", refs: [], for: "", changed }], this_week: [], unknowns: [], question: "¿Arrancamos?", action_label: "Hablar" });

async function signIn(email: string) {
  const c = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
async function setSynthesis(at: string, items: unknown[] = [{ id: "i1", title: "Hablar con Martín de El Pampita", why: "Antes de AOG.", refs: [`company:${company}`], tier: "hoy", source: "relevo", status: "activa", rank: 0, updated_at: at }]) {
  await pool.query(`update campaigns set synthesized_at = $2, synthesis = $3 where id = $1`, [vm, at, JSON.stringify({ opening: "x", today: [], this_week: [], focus: { items, log: [] } })]);
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Cambio material");
  ids = {} as never;
  for (const [k, email] of Object.entries(people)) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    if (error) throw error;
    ids[k as Who] = data.user.id;
  }
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')`, [ws, ids.tano, ids.fran, ids.jenny]);
  db = { tano: await signIn(people.tano), fran: await signIn(people.fran), jenny: await signIn(people.jenny) };
  vm = (await db.tano.from("campaigns").insert({ workspace_id: ws, name: "Vaca Muerta / Añelo", kind: "mision", status: "activa" }).select("id").single()).data!.id;
  await db.tano.from("mission_invitations").insert({ workspace_id: ws, campaign_id: vm, email: people.fran, role: "member", invited_by: ids.tano });
  await db.fran.rpc("accept_pending_invitations");
  company = (await db.tano.from("companies").insert({ workspace_id: ws, trade_name: "El Pampita", origin_campaign_id: vm }).select("id").single()).data!.id;
  await pool.query(`update workspaces set settings = $2 where id = $1`, [ws, JSON.stringify({ brief: { enabled: true, campaign_ids: [vm], recipients: [{ name: "Tano", email: people.tano }] } })]);
});
afterAll(async () => {
  await cleanup(pool, [ws], Object.entries(people).map(([k, email]) => ({ id: ids[k as Who], email })));
  await pool.end();
});

describe("silencio: sin cambio material no se gasta ni se inventa", () => {
  it("TEST 5 — síntesis Opus y pulso no corren; queda registrado el skip", async () => {
    await setSynthesis(ago(5));
    const ai = fakeAI(SYNTH(""));
    const s = await synthesizeMission(admin, { workspaceId: ws, campaignId: vm, client: ai.client });
    expect(s).toMatchObject({ ok: true, skipped: true, costUsd: 0 });
    expect(ai.calls).toHaveLength(0);
    const p = await pulse(admin, { id: vm, workspace_id: ws, slug: "x", settings: {} });
    expect(p.ran).toBe(false);
    const { count } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "skipped");
    expect(count).toBe(2);
  });

  it("una re-confirmación de otro medio (no material) no despierta nada", async () => {
    await setSynthesis(ago(5));
    await admin.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "otro", section: "general", headline: "Otro medio repite lo de El Pampita", change: "confirmado", relevance: "alta", material: false, campaign_ids: [vm], company_ids: [company] } as never);
    expect((await materialSince(admin, { missionId: vm, workspaceId: ws, since: ago(5) })).any).toBe(false);
    const ai = fakeAI(SYNTH(""));
    expect(await synthesizeMission(admin, { workspaceId: ws, campaignId: vm, client: ai.client })).toMatchObject({ ok: true, skipped: true });
    expect(ai.calls).toHaveLength(0);
  });

  it("TEST 1 — volver sin que haya pasado nada material: no hay 'Desde tu última visita' ni llamada a la IA", async () => {
    const ai = fakeAI({ changed: ["x"], next: "" });
    const r = await catchUp(db.tano, { workspaceId: ws, missionId: vm, userId: ids.tano, since: ago(4), names: new Map(), doNext: null, client: ai.client });
    expect(r).toBeNull();
    expect(ai.calls).toHaveLength(0);
  });
});

describe("colaboración: lo que aporta otro miembro es material para los demás", () => {
  it("TEST 6 — Fran aporta: queda con su autoría, es material para Tano y no para ella misma", async () => {
    await setSynthesis(ago(5));
    const { error } = await db.fran.from("evidence").insert({ workspace_id: ws, statement: "Hablé con el dueño de El Pampita: no vende, pero buscaría un socio para una segunda unidad.", evidence_type: "declaracion", origin_kind: "conversation", campaign_id: vm, company_id: company });
    expect(error).toBeNull();
    const forTano = await materialSince(db.tano, { missionId: vm, workspaceId: ws, since: ago(4), excludeUser: ids.tano });
    expect(forTano.items).toEqual([expect.objectContaining({ kind: "aporte", by: ids.fran })]);
    expect((await materialSince(db.fran, { missionId: vm, workspaceId: ws, since: ago(4), excludeUser: ids.fran })).any).toBe(false);
    // Jenny no está en la misión: no ve nada (RLS).
    expect((await materialSince(db.jenny, { missionId: vm, workspaceId: ws, since: ago(4) })).any).toBe(false);
  });

  it("la síntesis vuelve a pensar con lo que cambió y marca qué prioridad tocó (y su Avanzar se rehace)", async () => {
    const ai = fakeAI(SYNTH("Fran supo que el dueño buscaría un socio: preguntale por la segunda unidad."));
    const s = await synthesizeMission(admin, { workspaceId: ws, campaignId: vm, client: ai.client });
    expect(s).toMatchObject({ ok: true, skipped: false });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toContain("lo_que_cambio_desde_la_ultima_vez");
    expect(ai.calls[0]).toContain("segunda unidad");
    const { data } = await admin.from("campaigns").select("synthesis").eq("id", vm).single();
    const item = (data!.synthesis as { focus: { items: { title: string; changed: string | null; move: unknown }[] } }).focus.items[0];
    expect(item.changed).toMatch(/socio/);
    expect(item.move).toBeNull();
  });

  it("TEST 6 (cont.) — Tano vuelve: 'Desde tu última visita' se escribe con el aporte de Fran", async () => {
    const ai = fakeAI({ changed: ["Fran habló con El Pampita: el dueño descartó vender pero abrió la puerta a un socio."], next: "Hablar con Martín" });
    const r = await catchUp(db.tano, { workspaceId: ws, missionId: vm, userId: ids.tano, since: ago(4), names: new Map([[ids.fran, "Fran"]]), doNext: null, client: ai.client });
    expect(r!.changed).toHaveLength(1);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toContain("Fran");
    expect(ai.calls[0]).toContain("socio para una segunda unidad");
    // Fran, que lo aportó, no recibe su propio aporte como novedad.
    const ai2 = fakeAI({ changed: ["x"], next: "" });
    expect(await catchUp(db.fran, { workspaceId: ws, missionId: vm, userId: ids.fran, since: ago(4), names: new Map(), doNext: null, client: ai2.client })).toBeNull();
    expect(ai2.calls).toHaveLength(0);
  });
});

describe("Avanzar: solo se rehace si algo material lo toca", () => {
  it("una señal material sobre su empresa lo invalida; una repetida no", async () => {
    const at = ago(2);
    const it0 = { id: "i1", title: "Hablar con Martín", why: "", refs: [`company:${company}`], tier: "hoy" as const, source: "relevo" as const, status: "activa" as const, rank: 0, updated_at: ago(3), move: { text: "Mensaje listo", citations: [], at } };
    const m = { missionId: vm, workspaceId: ws };
    // El aporte de Fran (antes) no cuenta: es anterior a la preparación.
    expect(await moveServes(admin, m, it0, new Date())).toBe(true);
    await admin.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "otro", section: "general", headline: "Otra nota repetida de El Pampita", change: "confirmado", relevance: "alta", material: false, campaign_ids: [vm], company_ids: [company] } as never);
    expect(await moveServes(admin, m, it0, new Date())).toBe(true);
    await admin.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "otro", section: "general", headline: "Neuquén anunció una prueba de bitrenes hacia Añelo", change: "nuevo", relevance: "alta", material: true, campaign_ids: [vm], company_ids: [company] } as never);
    expect(await moveServes(admin, m, it0, new Date())).toBe(false);
    // Más de 72 horas: se rehace igual (los textos llevan fechas relativas).
    expect(await moveServes(admin, m, { ...it0, refs: [], move: { ...it0.move, at: ago(80) } }, new Date())).toBe(false);
  });
});

describe("deduplicación: artículo ≠ hecho", () => {
  const item = (title: string): MissionBrief["items"][number] => ({ title, why_us: "Puede ser un local ancla.", moves: ["oportunidad"], basis: "hecho", action: "", opportunity: "", connects: [], source_name: "Medio", source_url: "https://medio.test/nota" });
  const brief = (items: MissionBrief["items"]): MissionBrief => ({ opening: "Buenos días.", quiet: false, items, watching: "", discarded: [] });
  let briefId: string;

  it("TEST 3 — dos medios, mismo hecho: un solo acontecimiento, la segunda nota es fuente adicional y no entra al Brief", async () => {
    await admin.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "otro", section: "general", headline: "Café Martínez llega a Añelo", change: "nuevo", relevance: "alta", campaign_ids: [vm], happened_on: new Date().toISOString().slice(0, 10) } as never);
    briefId = await ensureTodayBrief(admin, ws, new Date("2026-10-04T08:00:00Z"));
    // La vigilancia ya había visto lo de los bitrenes (test de Avanzar): tampoco vuelve como novedad.
    const d = await dedupeMissionBrief(admin, vm, brief([item("Café Martínez desembarca en Añelo"), item("Pluspetrol busca proveedores de catering"), item("Neuquén prueba bitrenes hacia Añelo")]), briefId);
    expect(d.brief.items.map((x) => x.title)).toEqual(["Pluspetrol busca proveedores de catering"]);
    expect(d.brief.discarded).toEqual([{ title: "Café Martínez desembarca en Añelo", reason: "ya_lo_sabiamos" }, { title: "Neuquén prueba bitrenes hacia Añelo", reason: "ya_lo_sabiamos" }]);
    await saveMissionBrief(admin, { workspaceId: ws, briefId, missionId: vm, brief: d.brief, items: [], shown: d.shown, repeated: d.repeated });
    // Reintento del paso: no duplica.
    await saveMissionBrief(admin, { workspaceId: ws, briefId, missionId: vm, brief: d.brief, items: [], shown: d.shown, repeated: d.repeated });
    const { data } = await admin.from("brief_signals").select("headline, material, event_id, change").eq("brief_id", briefId).order("position");
    expect(data).toEqual([
      expect.objectContaining({ headline: "Pluspetrol busca proveedores de catering", material: true, event_id: null }),
      expect.objectContaining({ headline: "Café Martínez desembarca en Añelo", material: false, change: "confirmado", event_id: expect.any(String) }),
      expect.objectContaining({ headline: "Neuquén prueba bitrenes hacia Añelo", material: false, change: "confirmado", event_id: expect.any(String) }),
    ]);
  });

  it("TEST 4 — la segunda fuente trae contrato, operador y fecha: actualiza el hecho y vuelve a aparecer", async () => {
    const id2 = await ensureTodayBrief(admin, ws, new Date("2026-10-05T08:00:00Z"));
    const d = await dedupeMissionBrief(admin, vm, brief([item("Café Martínez firmó contrato: abre en Añelo con el operador Grupo Sur en noviembre")]), id2);
    expect(d.brief.items).toHaveLength(1);
    expect(d.shown[0]).toMatchObject({ kind: "actualiza", material: true });
  });
});

describe("Morning Brief: una investigación, un Brief, N destinatarios", () => {
  it("TEST 8 — los miembros que lo reciben se suman a la lista, sin repetir", async () => {
    // Fran se lo activa a sí misma (también puede hacerlo quien creó la misión); Jenny no está en la misión.
    const { data } = await db.fran.from("campaign_members").update({ brief_email: true }).eq("campaign_id", vm).eq("user_id", ids.fran).select("user_id");
    expect(data).toHaveLength(1);
    const to = await briefRecipients(admin, vm, [{ name: "Tano", email: people.tano.toUpperCase() }]);
    expect(to.map((r) => r.email).sort()).toEqual([people.fran, people.tano].sort());
  });
});

describe("eliminar misión", () => {
  it("TEST 9 — Fran (puede trabajar) no puede eliminarla; Tano sí, desaparece para todos, nada se borra y se puede deshacer", async () => {
    const { error: e1 } = await db.fran.rpc("archive_mission", { p_campaign: vm });
    expect(e1?.code).toBe("42501");
    const { error: e2 } = await db.fran.from("campaigns").update({ archived_at: new Date().toISOString() }).eq("id", vm);
    expect(e2).not.toBeNull();
    const { error } = await db.tano.rpc("archive_mission", { p_campaign: vm });
    expect(error).toBeNull();
    const { data: active } = await db.fran.from("campaigns").select("id").eq("kind", "mision").eq("status", "activa");
    expect(active).toEqual([]);
    expect(await briefMissionId(admin, ws, { brief: { campaign_ids: [vm] } })).toBeNull();
    // Lo de la misión sigue siendo de la misión: Jenny (fuera) no lo ve, Fran (dentro) sí.
    expect((await db.jenny.from("evidence").select("id").eq("campaign_id", vm)).data).toEqual([]);
    expect((await db.fran.from("evidence").select("id").eq("campaign_id", vm)).data).toHaveLength(1);
    await db.tano.rpc("restore_mission", { p_campaign: vm });
    const { data: back } = await admin.from("campaigns").select("status, archived_at").eq("id", vm).single();
    expect(back).toEqual({ status: "activa", archived_at: null });
  });
});

// Los tipos generados: event_id/material existen en brief_signals.
export type _Check = Database["public"]["Tables"]["brief_signals"]["Row"]["material"] extends boolean ? Json : never;
