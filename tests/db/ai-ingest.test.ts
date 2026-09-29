// P1: reglas de RELEVO AI (conversaciones, borradores) y de la ingesta del Morning Brief.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalUrl, dedupKey, hashToken } from "@/domain/ingest";
import { ingestFindings } from "@/server/ingest";
import { POST } from "@/app/api/ingest/findings/route";
import { addMember, asUser, cleanup, createUser, createWorkspace, newPool, type TestUser } from "./harness";
import type { Database } from "@/lib/supabase/database.types";

const pool = newPool();
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
let ws: string, wsB: string, tano: TestUser, fran: TestUser, viewer: TestUser, outsider: TestUser;
let conv: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "AI");
  wsB = await createWorkspace(pool, "Otro");
  tano = await createUser(pool, "tano");
  fran = await createUser(pool, "fran");
  viewer = await createUser(pool, "viewer");
  outsider = await createUser(pool, "outsider");
  await addMember(pool, ws, tano, "owner", true);
  await addMember(pool, ws, fran, "admin", true);
  await addMember(pool, ws, viewer, "viewer");
  await addMember(pool, wsB, outsider, "owner", true);
  conv = await asUser(
    pool,
    tano,
    async (c) => (await c.query(`insert into ai_conversations (workspace_id, user_id, title) values ($1, $2, 'Prueba') returning id`, [ws, tano.id])).rows[0].id,
    { commit: true },
  );
});

afterAll(async () => {
  await cleanup(pool, [ws, wsB], [tano, fran, viewer, outsider]);
  await pool.end();
});

describe("RELEVO AI: conversaciones y borradores", () => {
  it("todo el workspace lee la conversación; solo su autor escribe en ella", async () => {
    const seen = await asUser(pool, fran, async (c) => (await c.query(`select id from ai_conversations where id = $1`, [conv])).rowCount);
    expect(seen).toBe(1);
    await expect(
      asUser(pool, fran, (c) => c.query(`insert into ai_messages (workspace_id, conversation_id, role, text) values ($1, $2, 'user', 'hola')`, [ws, conv])),
    ).rejects.toThrow(/row-level security/);
    const outside = await asUser(pool, outsider, async (c) => (await c.query(`select id from ai_conversations where id = $1`, [conv])).rowCount);
    expect(outside).toBe(0);
  });

  it("un borrador solo nace 'propuesta' y un viewer no puede decidirlo", async () => {
    await expect(
      asUser(pool, tano, (c) =>
        c.query(`insert into ai_action_drafts (workspace_id, conversation_id, action, payload, status) values ($1, $2, 'create_task', '{}', 'ejecutada')`, [ws, conv]),
      ),
    ).rejects.toThrow(/row-level security/);
    const draft = await asUser(
      pool,
      tano,
      async (c) => (await c.query(`insert into ai_action_drafts (workspace_id, conversation_id, action, payload) values ($1, $2, 'create_task', '{"title":"x"}') returning id`, [ws, conv])).rows[0].id,
      { commit: true },
    );
    const upd = await asUser(pool, viewer, async (c) => (await c.query(`update ai_action_drafts set status = 'aprobada' where id = $1`, [draft])).rowCount);
    expect(upd).toBe(0);
  });
});

describe("ingesta del Morning Brief", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    url: "https://Www.Medio.example/nota-1?utm_source=brief#arriba",
    title: "Se instala un nuevo campamento",
    publisher: "Medio",
    published_at: "2026-09-27",
    statement: "Un operador anunció un campamento para 400 trabajadores en Añelo",
    topic: "alojamiento",
    ...over,
  });

  it("canoniza URLs y deduplica por URL + afirmación", () => {
    expect(canonicalUrl("https://Www.Medio.example/nota-1/?utm_source=x&b=2&a=1#top")).toBe("https://medio.example/nota-1?a=1&b=2");
    expect(dedupKey("https://medio.example/nota-1?utm_medium=y", "Un   operador ANUNCIÓ")).toBe(dedupKey("https://www.medio.example/nota-1", "un operador anuncio"));
  });

  it("crea hallazgos pendientes, reutiliza la fuente y no duplica al reimportar", async () => {
    const first = await ingestFindings(admin, ws, [item(), item({ statement: "Otra afirmación de la misma nota" }), { url: "no-es-url" }], { sourceSystem: "morning-brief" });
    expect(first.created).toBe(2);
    expect(first.rejected).toHaveLength(1);
    const again = await ingestFindings(admin, ws, [item({ url: "https://medio.example/nota-1" })], { sourceSystem: "morning-brief" });
    expect(again).toMatchObject({ created: 0, duplicates: 1 });
    const { rows } = await pool.query(
      `select f.review_status, f.origin, f.verification_status, s.url, s.kind
       from findings f join sources s on s.id = f.source_id where f.workspace_id = $1`,
      [ws],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.url))).toEqual(new Set(["https://medio.example/nota-1"]));
    expect(rows.every((r) => r.review_status === "pendiente_revision" && r.origin === "research_externo" && r.verification_status === "partially_verified")).toBe(true);
    const opps = await pool.query(`select 1 from opportunities where workspace_id = $1`, [ws]);
    expect(opps.rowCount).toBe(0);
  });

  it("el endpoint exige token válido y no revocado, y escribe solo en su workspace", async () => {
    const token = `rlv_${randomBytes(24).toString("base64url")}`;
    const { rows } = await pool.query(
      `insert into ingest_tokens (workspace_id, name, token_hash, token_hint, created_by) values ($1, 'Morning Brief', $2, $3, $4) returning id`,
      [wsB, hashToken(token), token.slice(-4), outsider.id],
    );
    const call = (auth: string | null, body: unknown) =>
      POST(
        new Request("http://localhost/api/ingest/findings", {
          method: "POST",
          headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }) as never,
      );

    expect((await call(null, { items: [item()] })).status).toBe(401);
    expect((await call("Bearer rlv_inventado", { items: [item()] })).status).toBe(401);
    expect((await call(`Bearer ${token}`, "{no json")).status).toBe(400);
    expect((await call(`Bearer ${token}`, { items: [] })).status).toBe(400);

    const ok = await call(`Bearer ${token}`, { source_system: "morning-brief", items: [item()] });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ created: 1, duplicates: 0 });
    const dup = await call(`Bearer ${token}`, { items: [item()] });
    expect(await dup.json()).toMatchObject({ created: 0, duplicates: 1 });

    // Quedó en el workspace del token (B), no en A.
    const inB = await pool.query(`select count(*)::int as n from findings where workspace_id = $1 and ingest_token_id = $2`, [wsB, rows[0].id]);
    expect(inB.rows[0].n).toBe(1);

    await pool.query(`update ingest_tokens set revoked_at = now() where id = $1`, [rows[0].id]);
    expect((await call(`Bearer ${token}`, { items: [item({ statement: "nueva" })] })).status).toBe(401);
  });

  it("solo owner/admin crean tokens de ingesta", async () => {
    await expect(
      asUser(pool, viewer, (c) =>
        c.query(`insert into ingest_tokens (workspace_id, name, token_hash, token_hint, created_by) values ($1, 'x', 'h1', 'abcd', $2)`, [ws, viewer.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
