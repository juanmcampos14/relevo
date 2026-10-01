// Lo que la persona dicta y RELEVO aplica solo: "ya le escribí" cierra el pendiente y deja un seguimiento;
// "confirmó el miércoles 11:30" agenda la reunión en la misión con su objetivo y el link de Calendar.
// Todo se puede deshacer sin dejar rastro. RLS real con un usuario owner.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { applyContactEvent, calendarLink, followUpDay, undoContactEvent } from "@/server/ai/contact-events";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-ev-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
let ws: string, userId: string, db: SupabaseClient<Database>, mission: string, company: string, contact: string, target: string, outreach: string;
const NOW = new Date("2026-10-01T15:00:00Z"); // jueves

beforeAll(async () => {
  ws = await createWorkspace(pool, "Eventos");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [ws, userId]);
  const q = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
  mission = await q(`insert into campaigns (workspace_id, name, kind, status, starts_on, ends_on) values ($1, 'Añelo', 'mision', 'activa', '2026-10-16', '2026-10-26') returning id`, [ws]);
  company = await q(`insert into companies (workspace_id, trade_name) values ($1, 'Urban View') returning id`, [ws]);
  contact = await q(`insert into contacts (workspace_id, full_name) values ($1, 'Alejandro Marcus') returning id`, [ws]);
  await pool.query(`insert into contact_links (workspace_id, contact_id, company_id) values ($1, $2, $3)`, [ws, contact, company]);
  target = await q(`insert into campaign_targets (workspace_id, campaign_id, company_id) values ($1, $2, $3) returning id`, [ws, mission, company]);
  outreach = await q(`insert into tasks (workspace_id, title, status, due_on, contact_id, target_id) values ($1, 'Revisar borrador Urban View y solicitar reunión', 'todo', '2026-10-01', $2, $3) returning id`, [ws, contact, target]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

const ctx = () => ({ workspaceId: ws, userId, campaignId: mission, now: NOW });

describe("acciones que RELEVO aplica solo", () => {
  it("seguimiento a 3 días hábiles y Calendar con hora argentina", () => {
    expect(followUpDay(NOW)).toBe("2026-10-06");
    const url = new globalThis.URL(calendarLink({ title: "Reunión", date: "2026-10-07", time: "11:30" }));
    expect(url.searchParams.get("dates")).toBe("20261007T143000Z/20261007T153000Z");
  });

  it("'ya le escribí' cierra el pendiente y deja el seguimiento; deshacer lo revierte", async () => {
    const r = await applyContactEvent(db, ctx(), { event: "mensaje_enviado", contact_ref: `contact:${contact}`, channel: "WhatsApp" });
    expect(r.summary).toContain("Alejandro Marcus · Urban View");
    const { data: t } = await db.from("tasks").select("status").eq("id", outreach).single();
    expect(t!.status).toBe("done");
    const { data: f } = await db.from("tasks").select("title, due_on, kind, target_id").eq("id", r.effects.created_tasks[0]).single();
    expect(f).toMatchObject({ due_on: "2026-10-06", kind: "Seguimiento", target_id: target });
    await undoContactEvent(db, r.effects);
    expect((await db.from("tasks").select("status").eq("id", outreach).single()).data!.status).toBe("todo");
    expect((await db.from("tasks").select("id").eq("id", r.effects.created_tasks[0])).data).toEqual([]);
  });

  it("'confirmó el miércoles 11:30' agenda la reunión en la misión; deshacer no deja rastro", async () => {
    const r = await applyContactEvent(db, ctx(), { event: "reunion_confirmada", contact_ref: `contact:${contact}`, date: "2026-10-07", time: "11:30", objective: "Validar ocupación y quién contrata" });
    expect(r.effects.calendar_url).toContain("calendar.google.com");
    const { data: stop } = await db.from("visit_stops").select("target_id, target_time, status, visit_plans(planned_on, campaign_id)").eq("id", r.effects.created_stop!).single();
    expect(stop).toMatchObject({ target_id: target, target_time: "11:30:00", status: "confirmada", visit_plans: { planned_on: "2026-10-07", campaign_id: mission } });
    expect((await db.from("tasks").select("status").eq("id", outreach).single()).data!.status).toBe("done");
    await undoContactEvent(db, r.effects);
    expect((await db.from("visit_plans").select("id").eq("campaign_id", mission)).data).toEqual([]);
    expect((await db.from("tasks").select("status").eq("id", outreach).single()).data!.status).toBe("todo");
  });
});
