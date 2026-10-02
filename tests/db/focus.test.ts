// Home vivo: cada acción cambia el presente de RELEVO. Mandar el mensaje resuelve la prioridad y aparece la
// siguiente; deshacer la devuelve; las correcciones de la persona quedan para el Brain. RLS real (member).
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { applyCorrection, liveFocus, loadFocus, stepTaken } from "@/server/mission/focus";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-foco-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
let ws: string, userId: string, db: SupabaseClient<Database>, mission: string, ferrelec: string, contact: string, vista: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Foco");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'member')`, [ws, userId]);
  const q = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
  ferrelec = await q(`insert into companies (workspace_id, trade_name) values ($1, 'FERRELEC') returning id`, [ws]);
  vista = await q(`insert into companies (workspace_id, trade_name) values ($1, 'Vista') returning id`, [ws]);
  contact = await q(`insert into contacts (workspace_id, full_name) values ($1, 'Comercial FERRELEC') returning id`, [ws]);
  await pool.query(`insert into contact_links (workspace_id, contact_id, company_id) values ($1, $2, $3)`, [ws, contact, ferrelec]);
  const synthesis = {
    today: [
      { title: "Mandar el pedido de reunión a FERRELEC", why: "Abre la puerta del abastecimiento", refs: [`company:${ferrelec}`] },
      { title: "Pedir la presentación con Vista", why: "Lado comprador", refs: [`company:${vista}`] },
    ],
    this_week: [{ title: "Preparar AOG", why: "Faltan días", refs: [] }],
  };
  mission = await q(`insert into campaigns (workspace_id, name, kind, status, starts_on, synthesis) values ($1, 'Añelo', 'mision', 'activa', '2026-10-16', $2) returning id`, [ws, JSON.stringify(synthesis)]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("home vivo", () => {
  it("el foco nace de la síntesis y muestra lo de hoy", async () => {
    const { now } = await liveFocus(db, mission);
    expect(now.map((x) => x.title)).toEqual(["Mandar el pedido de reunión a FERRELEC", "Pedir la presentación con Vista"]);
  });

  it("mandar el mensaje a la persona resuelve la prioridad de su empresa y aparece la siguiente; deshacer la devuelve", async () => {
    const step = await stepTaken(db, mission, { contact_ref: `contact:${contact}` }, "Contacto enviado");
    expect(step.resolved.map((x) => x.title)).toEqual(["Mandar el pedido de reunión a FERRELEC"]);
    expect(step.next?.title).toBe("Pedir la presentación con Vista");
    await applyCorrection(db, mission, { kind: "reactivar", ids: step.resolved.map((x) => x.id) }, userId);
    expect((await liveFocus(db, mission)).now.map((x) => x.title)[0]).toBe("Mandar el pedido de reunión a FERRELEC");
  });

  it("'esto primero' y 'mañana' se aplican al instante y quedan registrados para el Brain", async () => {
    const f = await loadFocus(db, mission);
    const vistaItem = f.items.find((x) => x.title.includes("Vista"))!;
    const ferrelecItem = f.items.find((x) => x.title.includes("FERRELEC"))!;
    await applyCorrection(db, mission, { kind: "primero", id: vistaItem.id }, userId);
    await applyCorrection(db, mission, { kind: "posponer", id: ferrelecItem.id, until: "2099-01-01", note: "FERRELEC mañana" }, userId);
    const { now, focus } = await liveFocus(db, mission);
    expect(now.map((x) => x.title)).toEqual(["Pedir la presentación con Vista"]);
    expect(focus.log[0]).toMatchObject({ by: userId, what: "la pospuso hasta el 2099-01-01", note: "FERRELEC mañana" });
    // La síntesis y el plan de AOG siguen ahí: el foco vive al lado.
    const { data } = await db.from("campaigns").select("synthesis").eq("id", mission).single();
    expect((data!.synthesis as { today: unknown[] }).today).toHaveLength(2);
  });
});
