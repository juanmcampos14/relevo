// Morning Brief: un brief por día guardado en RELEVO → señales cruzadas con la memoria → historias vivas →
// candidatos sin alta automática → email como salida, con reintento sin repetir el research.
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { BriefDraft, DraftSignalT } from "@/domain/brief/contract";
import type { EmailMessage, EmailProvider } from "@/server/email/provider";
import type { Engines } from "@/server/brief/pipeline";
import { advanceBrief, ensureTodayBrief } from "@/server/brief/pipeline";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, pecom: string, finding: string;

const signal = (o: Partial<DraftSignalT>): DraftSignalT => ({
  key: "s1", headline: "PECOM amplía su base en Añelo", summary: "Anunció una ampliación de su base operativa.", happened_on: "2026-10-15",
  source_url: "https://www.vacamuertanews.com/actualidad/pecom-base.htm", source_title: "PECOM amplía", publisher: "Vaca Muerta News",
  basis: "declaracion", signal_type: "movimiento_empresa", section: "empresas", geography: "Añelo", vertical: "Servicios industriales", subsector: "",
  roles: ["contratista"], companies: ["PECOM"], people: [], why_it_matters: "Más personal en Añelo", reading: "Demanda de viandas y housing",
  change: "nuevo", relevance: "alta", story_ref: "nueva:pecom-base", related_company_ids: [], related_finding_ids: [], related_campaign_ids: [], related_asset_ids: [], suggested_action: "Pedir intro a compras de PECOM", verify: "Si abre compras locales", talk_to: "Compras de PECOM", ask: "¿Cuántas personas suma la base?",
  ...o,
});

function draft(signals: DraftSignalT[], extra: Partial<BriefDraft> = {}): BriefDraft {
  return {
    headline_points: [{ text: "PECOM amplía base en Añelo", signal_keys: ["s1"] }],
    signals,
    stories: [{ ref: "nueva:pecom-base", title: "Expansión de PECOM en Añelo", summary: "Anunció ampliación." }],
    connections: [{ text: "Cruza con la hipótesis de viandas", signal_keys: ["s1"], memory_refs: [`finding:${finding}`, "finding:no-es-uuid"] }],
    actions: [{ title: "Pedir intro a compras de PECOM", why: "Nuevo personal", signal_keys: ["s1"] }],
    field_questions: [{ question: "Preguntar a dos viandas si PECOM pidió cotización", vertical: "Viandas / catering", why: "" }],
    watchlist: [],
    candidates: [
      { kind: "empresa", name: "PECOM", detail: "ya está en el CRM", source_url: "" },
      { kind: "empresa", name: "Constructora Patagonia SA", detail: "contratista de la base", source_url: "https://x.test/c" },
    ],
    quiet_day_note: "",
    ...extra,
  };
}

class FlakyEmail implements EmailProvider {
  name = "fake";
  sent: EmailMessage[] = [];
  failNext = true;
  async send(m: EmailMessage) {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false as const, error: "proveedor caído", retryable: true };
    }
    this.sent.push(m);
    return { ok: true as const, messageId: `m-${this.sent.length}` };
  }
}

let researchCalls = 0;
const engines = (d: BriefDraft, email: EmailProvider | null): Engines => ({
  research: { research: async () => (researchCalls++, { memo: "memo", sources: [{ url: "https://www.vacamuertanews.com/actualidad/pecom-base.htm", title: "PECOM amplía" }], engine: { provider: "fake", model: "f" }, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, costUsd: 0.1 } }) },
  synthesis: { synthesize: async () => ({ draft: d, engine: { provider: "fake", model: "f" }, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, costUsd: 0.2 } }) },
  email,
});

async function atStep(briefId: string, items = [{ url: "https://www.vacamuertanews.com/actualidad/pecom-base.htm", title: "PECOM amplía", publisher: "Vaca Muerta News", publishedAt: null, priority: "vmn", description: null, body: "…" }]) {
  // Saltea la recolección por red: el brief arranca con las notas ya recolectadas.
  await db.from("briefs").update({ status: "investigando", collected: items }).eq("id", briefId);
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Brief");
  await pool.query(`update workspaces set settings = $2 where id = $1`, [ws, JSON.stringify({ brief: { enabled: true, recipients: [{ name: "Tano", email: "tano@test.local" }, { name: "Fran", email: "fran@test.local" }, { name: "Jenny", email: "jenny@test.local" }] } })]);
  pecom = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'PECOM') returning id`, [ws])).rows[0].id;
  const src = (await pool.query(`insert into sources (workspace_id, kind, title) values ($1, 'observacion', 'x') returning id`, [ws])).rows[0].id;
  finding = (await pool.query(`insert into findings (workspace_id, source_id, kind, statement, origin) values ($1, $2, 'necesidad', 'Faltan viandas para contratistas', 'ia') returning id`, [ws, src])).rows[0].id;
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("Morning Brief", () => {
  let briefId: string;
  const email = new FlakyEmail();

  it("un solo brief por día (idempotente)", async () => {
    const now = new Date("2026-10-16T08:00:00Z");
    briefId = await ensureTodayBrief(db, ws, now);
    expect(await ensureTodayBrief(db, ws, now)).toBe(briefId);
  });

  it("investigar → sintetizar: señales cruzadas con la memoria, historia nueva, candidatos filtrados", async () => {
    await atStep(briefId);
    const d = draft([signal({ related_company_ids: ["00000000-0000-0000-0000-000000000000"], related_finding_ids: [finding] })]);
    expect(await advanceBrief(db, briefId, engines(d, email), { siteUrl: "https://relevo.test" })).toMatchObject({ status: "sintetizando", more: true });
    const out = await advanceBrief(db, briefId, engines(d, email), { siteUrl: "https://relevo.test" });
    expect(out).toMatchObject({ status: "generado", more: true });

    const { data: b } = await db.from("briefs").select("status, content, usage").eq("id", briefId).single();
    const c = b!.content as { signals: { company_ids: string[]; finding_ids: string[]; story_title: string }[]; candidates: { name: string }[]; connections: { memory_refs: string[] }[]; vertical_radar: { vertical: string }[] };
    // El id inventado se descarta; PECOM se vincula por nombre; la hipótesis citada existe.
    expect(c.signals[0]).toMatchObject({ company_ids: [pecom], finding_ids: [finding], story_title: "Expansión de PECOM en Añelo" });
    // Detectado ≠ validado: PECOM ya está en el CRM y no vuelve como candidato.
    expect(c.candidates.map((x) => x.name)).toEqual(["Constructora Patagonia SA"]);
    expect(c.connections[0].memory_refs).toEqual([`finding:${finding}`]);
    expect(c.vertical_radar[0].vertical).toBe("Servicios industriales");
    const { count: companies } = await db.from("companies").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(companies).toBe(1);
    const { data: seen } = await db.from("brief_source_items").select("url, first_brief_id").eq("workspace_id", ws);
    expect(seen).toEqual([{ url: "https://www.vacamuertanews.com/actualidad/pecom-base.htm", first_brief_id: briefId }]);
    const { data: deliveries } = await db.from("brief_deliveries").select("recipient_email, status").eq("brief_id", briefId).order("recipient_email");
    expect(deliveries!.map((x) => `${x.recipient_email}:${x.status}`)).toEqual(["fran@test.local:pendiente", "jenny@test.local:pendiente", "tano@test.local:pendiente"]);
  });

  it("si falla el email, el brief queda generado y se reintenta solo el envío (mismo objeto para los tres)", async () => {
    const d = draft([signal({})]);
    const first = await advanceBrief(db, briefId, engines(d, email), { siteUrl: "https://relevo.test" });
    expect(first.error).toMatch(/proveedor caído/);
    const { data: b } = await db.from("briefs").select("status").eq("id", briefId).single();
    expect(b!.status).toBe("generado");
    const calls = researchCalls;
    await advanceBrief(db, briefId, engines(d, email), { siteUrl: "https://relevo.test" });
    expect(researchCalls).toBe(calls);
    const { data: deliveries } = await db.from("brief_deliveries").select("status, provider_message_id, attempts").eq("brief_id", briefId);
    expect(deliveries!.every((x) => x.status === "enviado")).toBe(true);
    expect(new Set(email.sent.map((m) => m.subject)).size).toBe(1);
    expect(new Set(email.sent.map((m) => m.html)).size).toBe(1);
    expect(email.sent.every((m) => m.idempotencyKey.startsWith(`brief-${briefId}-`))).toBe(true);
    expect(email.sent[0].html).toContain(`https://relevo.test/w/`);
  });

  it("al día siguiente la misma historia se actualiza (no es noticia nueva) y pasa a watchlist con memoria", async () => {
    const { data: story } = await db.from("brief_stories").select("id").eq("workspace_id", ws).single();
    const next = await ensureTodayBrief(db, ws, new Date("2026-10-17T08:00:00Z"));
    expect(next).not.toBe(briefId);
    await atStep(next, []);
    const d = draft(
      [signal({ key: "s1", headline: "PECOM contrata constructora para la base", change: "actualizado", story_ref: story!.id, source_url: "https://x.test/pecom-2" })],
      { stories: [{ ref: story!.id, title: "", summary: "Ya contrató constructora." }], watchlist: [{ story_ref: story!.id, title: "Expansión de PECOM", why: "Ver si abre compras locales" }], candidates: [{ kind: "empresa", name: "Constructora Patagonia SA", detail: "otra vez", source_url: "" }] },
    );
    await advanceBrief(db, next, engines(d, null), { siteUrl: "https://relevo.test" });
    await advanceBrief(db, next, engines(d, null), { siteUrl: "https://relevo.test" });
    const { data: s } = await db.from("brief_stories").select("summary, status, watch_reason, first_seen_on, last_seen_on").eq("id", story!.id).single();
    expect(s).toEqual({ summary: "Ya contrató constructora.", status: "watchlist", watch_reason: "Ver si abre compras locales", first_seen_on: "2026-10-16", last_seen_on: "2026-10-17" });
    const { data: b } = await db.from("briefs").select("content, period_start").eq("id", next).single();
    const c = b!.content as { watchlist: { title: string; since: string }[]; candidates: unknown[]; changes: { actualizado: unknown[] } };
    expect(c.watchlist).toEqual([expect.objectContaining({ title: "Expansión de PECOM en Añelo", since: "2026-10-16" })]);
    expect(c.candidates).toEqual([]);
    expect(c.changes.actualizado).toHaveLength(1);

    // Sin proveedor configurado: el brief existe y los envíos quedan fallidos con el motivo, listos para reintentar.
    const out = await advanceBrief(db, next, engines(d, null), { siteUrl: "https://relevo.test" });
    expect(out.error).toMatch(/No hay proveedor de email/);
    const { data: dl } = await db.from("brief_deliveries").select("status").eq("brief_id", next);
    expect(dl!.every((x) => x.status === "fallido")).toBe(true);
  });
});
