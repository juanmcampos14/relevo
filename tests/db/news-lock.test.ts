// La actualización de noticias no puede dispararse en paralelo (estampida de precargas).
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { addMember, asUser, cleanup, createUser, createWorkspace, newPool, type TestUser } from "./harness";

const pool = newPool();
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, viewer: TestUser;

beforeAll(async () => {
  ws = await createWorkspace(pool, "News");
  viewer = await createUser(pool, "viewer");
  await addMember(pool, ws, viewer, "viewer");
});
afterAll(async () => {
  await cleanup(pool, [ws], [viewer]);
  await pool.end();
});

describe("reserva de actualización de noticias", () => {
  it("de 20 pedidos simultáneos gana uno solo", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => admin.rpc("claim_news_refresh", { p_ws: ws, p_topic: "vaca_muerta", p_stale: "3 hours" })),
    );
    expect(results.filter((r) => r.data === true)).toHaveLength(1);
  });

  it("tras un éxito no se vuelve a reservar hasta que venza; tras un error espera", async () => {
    await admin.rpc("finish_news_refresh", { p_ws: ws, p_topic: "vaca_muerta", p_ok: true });
    expect((await admin.rpc("claim_news_refresh", { p_ws: ws, p_topic: "vaca_muerta", p_stale: "3 hours" })).data).toBe(false);
    // Manual (sin antigüedad mínima) sí puede.
    expect((await admin.rpc("claim_news_refresh", { p_ws: ws, p_topic: "vaca_muerta", p_stale: "0 seconds" })).data).toBe(true);
    await admin.rpc("finish_news_refresh", { p_ws: ws, p_topic: "vaca_muerta", p_ok: false });
    expect((await admin.rpc("claim_news_refresh", { p_ws: ws, p_topic: "vaca_muerta", p_stale: "0 seconds" })).data).toBe(false);
  });

  it("un viewer no puede disparar actualizaciones", async () => {
    const won = await asUser(pool, viewer, async (c) => (await c.query(`select public.claim_news_refresh($1, 'otro', '0 seconds') as w`, [ws])).rows[0].w);
    expect(won).toBe(false);
  });
});
