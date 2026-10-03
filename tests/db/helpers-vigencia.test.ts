// Quien dejó la empresa no se recomienda aunque figure en un análisis anterior (caso Raviola / PECOM).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { formerContacts, splitHelpers } from "@/server/mission/helpers-vigencia";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, gone: string, stays: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Vigencia");
  const pecom = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'PECOM') returning id`, [ws])).rows[0].id;
  gone = (await pool.query(`insert into contacts (workspace_id, full_name) values ($1, 'Nicolas Raviola') returning id`, [ws])).rows[0].id;
  stays = (await pool.query(`insert into contacts (workspace_id, full_name) values ($1, 'Ana Compras') returning id`, [ws])).rows[0].id;
  await pool.query(`insert into contact_links (workspace_id, contact_id, company_id, valid_until) values ($1, $2, $3, '2026-10-02'), ($1, $4, $3, null)`, [ws, gone, pecom, stays]);
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("quién puede ayudar, con relaciones vigentes", () => {
  it("quien dejó la empresa sale de la recomendación y queda como 'ya no está'", async () => {
    const helpers = [
      { ref: `contact:${gone}`, name: "Nicolas Raviola · PECOM", purpose: "vender_crear" as const, why: "compras", ask: "¿alquilan nave?" },
      { ref: `contact:${stays}`, name: "Ana Compras · PECOM", purpose: "vender_crear" as const, why: "compras", ask: "¿alquilan nave?" },
      { ref: "company:00000000-0000-0000-0000-000000000000", name: "Añelo Storage", purpose: "inteligencia" as const, why: "vacancia", ask: "¿canon?" },
    ];
    const former = await formerContacts(db, helpers.map((h) => h.ref));
    const { current, no_longer } = splitHelpers(helpers, former);
    expect(current.map((h) => h.name)).toEqual(["Ana Compras · PECOM", "Añelo Storage"]);
    expect(no_longer).toEqual([{ ref: `contact:${gone}`, name: "Nicolas Raviola", note: "ya no está en PECOM (desde 2026-10-02): buscar quién lo reemplaza" }]);
  });
});
