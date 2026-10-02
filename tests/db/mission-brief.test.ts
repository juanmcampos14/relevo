// El Morning Brief de la misión: lo mostrado queda como señal de la misión (mañana no se repite), lo leído
// queda como visto, y el email que sale es el del Brief de la misión (mismo objeto para cada destinatario).
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { MissionBrief, MissionBriefContent } from "@/domain/brief/mission-brief";
import type { EmailMessage, EmailProvider } from "@/server/email/provider";
import { missionBrief } from "@/server/ai/mission";
import { BRIEF_VERSION, deliverBrief, ensureTodayBrief } from "@/server/brief/pipeline";
import { briefMissionId, saveMissionBrief } from "@/server/brief/mission-brief";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, vm: string, lao: string;

const brief: MissionBrief = {
  opening: "Buenos días, Tano. Hay una fecha que cambia la agenda.",
  quiet: false,
  items: [{ title: "AOG Patagonia es del 19 al 22 de octubre", why_us: "Las reuniones del 21–22 se pisan con AOG.", moves: ["agenda"], basis: "hecho", action: "Mover las reuniones B2B al 15 o 16.", opportunity: "", connects: [], source_name: "Río Negro", source_url: "https://www.rionegro.com.ar/aog" }],
  watching: "Sigo mirando: locales de 50 m² con precio.",
  discarded: [{ title: "YPF invierte en Vaca Muerta", reason: "ya_lo_sabiamos" }],
};

class Mailbox implements EmailProvider {
  name = "fake";
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
    return { ok: true as const, messageId: `m-${this.sent.length}` };
  }
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Brief misión");
  vm = (await pool.query(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'Vaca Muerta / Añelo — Research', 'mision', 'activa') returning id`, [ws])).rows[0].id;
  lao = (await pool.query(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'LAO', 'mision', 'activa') returning id`, [ws])).rows[0].id;
  await pool.query(`update workspaces set settings = $2 where id = $1`, [ws, JSON.stringify({ brief: { enabled: true, campaign_ids: [vm], recipients: [{ name: "Tano", email: "tano@test.local" }, { name: "Fran", email: "fran@test.local" }] } })]);
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("Brief de la misión", () => {
  it("usa la misión configurada para el Brief", async () => {
    expect(await briefMissionId(db, ws, { brief: { campaign_ids: [vm] } })).toBe(vm);
    expect(await briefMissionId(db, ws, {})).toBe(vm);
  });

  it("lo mostrado queda como señal de esa misión y lo leído como visto", async () => {
    const id = await ensureTodayBrief(db, ws, new Date("2026-10-20T08:00:00Z"));
    const { data: b } = await db.from("briefs").select("version").eq("id", id).single();
    expect(b!.version).toBe(BRIEF_VERSION);
    await saveMissionBrief(db, { workspaceId: ws, briefId: id, missionId: vm, brief, items: [{ url: "https://www.rionegro.com.ar/aog", title: "AOG", publisher: "Río Negro", publishedAt: null, priority: "regional", description: null, body: null, alreadySeen: false, query: "AOG" }] });
    // La misión lo ve entre lo ya reportado (así mañana no vuelve como novedad); otra misión no.
    expect((await missionBrief(db, vm, new Date(), { withSynthesis: false }))!.recent_signals.map((s) => s.headline)).toContain("AOG Patagonia es del 19 al 22 de octubre");
    expect((await missionBrief(db, lao, new Date(), { withSynthesis: false }))!.recent_signals).toHaveLength(0);
    const { count } = await db.from("brief_source_items").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count).toBe(1);
  });

  it("el email que sale es el del Brief de la misión, igual para cada destinatario", async () => {
    const id = await ensureTodayBrief(db, ws, new Date("2026-10-21T08:00:00Z"));
    const content: MissionBriefContent = { kind: "mision", mission_id: vm, mission_name: "Vaca Muerta / Añelo", brief, metrics: { mode: "completo", costUsd: 0.8, monthCostUsd: 0.8, monthlyCapUsd: 60, collected: 50, webSearches: 8, shown: 1, discarded: 1 } };
    await db.from("briefs").update({ status: "generado", content: content as unknown as NonNullable<Json>, generated_at: new Date().toISOString() }).eq("id", id);
    await db.from("brief_deliveries").insert([{ workspace_id: ws, brief_id: id, recipient_email: "tano@test.local" }, { workspace_id: ws, brief_id: id, recipient_email: "fran@test.local" }]);
    const mail = new Mailbox();
    expect(await deliverBrief(db, id, mail, { siteUrl: "https://relevo.test" })).toMatchObject({ sent: 2, failed: 0 });
    expect(mail.sent[0].subject).toMatch(/^RELEVO · Vaca Muerta \/ Añelo · /);
    expect(mail.sent[0].html).toContain("Por qué importa");
    expect(mail.sent[0].html).toContain('href="https://www.rionegro.com.ar/aog"');
    expect(mail.sent[0].html).toContain("https://relevo.test/hoy/");
    expect(mail.sent[1].html).toBe(mail.sent[0].html);
  });
});
