// Research → Finding → Revisión → Candidata → Aprobación → Dealflow.
// Un finding nunca se convierte solo en oportunidad; aprobar exige capacidad explícita.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, cleanup, createUser, createWorkspace, newPool, type TestUser } from "./harness";

const pool = newPool();
let ws: string, tano: TestUser, fran: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser, wsB: string;
let sourceId: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Dealflow");
  wsB = await createWorkspace(pool, "Otro");
  tano = await createUser(pool, "tano");
  fran = await createUser(pool, "fran");
  member = await createUser(pool, "member");
  viewer = await createUser(pool, "viewer");
  outsider = await createUser(pool, "outsider");
  await addMember(pool, ws, tano, "owner", true);
  await addMember(pool, ws, fran, "admin", true);
  await addMember(pool, ws, member, "member", false);
  await addMember(pool, ws, viewer, "viewer", false);
  await addMember(pool, wsB, outsider, "owner", true);
  sourceId = (
    await pool.query(`insert into sources (workspace_id, kind, title, url) values ($1, 'url', 'Nota', 'https://example.com/n') returning id`, [ws])
  ).rows[0].id;
});

afterAll(async () => {
  await cleanup(pool, [ws, wsB], [tano, fran, member, viewer, outsider]);
  await pool.end();
});

async function newFinding(u: TestUser, statement = "Necesitan lavandería industrial") {
  return asUser(
    pool,
    u,
    async (c) =>
      (
        await c.query(`insert into findings (workspace_id, source_id, kind, statement) values ($1, $2, 'necesidad', $3) returning id`, [
          ws,
          sourceId,
          statement,
        ])
      ).rows[0].id as string,
    { commit: true },
  );
}

describe("findings", () => {
  it("exigen fuente y nacen pendientes de revisión", async () => {
    await expect(
      asUser(pool, tano, (c) => c.query(`insert into findings (workspace_id, kind, statement) values ($1, 'necesidad', 'x')`, [ws])),
    ).rejects.toThrow(/source_id/);
    await expect(
      asUser(pool, tano, (c) =>
        c.query(`insert into findings (workspace_id, source_id, kind, statement, review_status) values ($1, $2, 'necesidad', 'x', 'aprobado')`, [
          ws,
          sourceId,
        ]),
      ),
    ).rejects.toThrow(/nace pendiente/);
  });

  it("revisar registra quién y cuándo; un revisado no se edita sin volver a pendiente", async () => {
    const id = await newFinding(member);
    await asUser(pool, fran, (c) => c.query(`update findings set review_status = 'aprobado' where id = $1`, [id]), { commit: true });
    const { rows } = await pool.query(`select reviewed_by, reviewed_at from findings where id = $1`, [id]);
    expect(rows[0].reviewed_by).toBe(fran.id);
    expect(rows[0].reviewed_at).not.toBeNull();
    await expect(
      asUser(pool, tano, (c) => c.query(`update findings set statement = 'otra cosa' where id = $1`, [id])),
    ).rejects.toThrow(/volvelo a pendiente/);
  });

  it("dedup_key evita duplicar la misma ingesta", async () => {
    await asUser(pool, tano, (c) =>
      c.query(`insert into findings (workspace_id, source_id, kind, statement, dedup_key) values ($1, $2, 'senal_de_mercado', 'a', 'k1')`, [ws, sourceId]),
    { commit: true });
    await expect(
      asUser(pool, tano, (c) =>
        c.query(`insert into findings (workspace_id, source_id, kind, statement, dedup_key) values ($1, $2, 'senal_de_mercado', 'a', 'k1')`, [ws, sourceId]),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("oportunidades", () => {
  it("no se vinculan findings pendientes ni rechazados", async () => {
    const pending = await newFinding(tano);
    await expect(
      asUser(pool, tano, async (c) => {
        const opp = (await c.query(`insert into opportunities (workspace_id, title) values ($1, 'Lavandería') returning id`, [ws])).rows[0].id;
        await c.query(`insert into opportunity_findings (workspace_id, opportunity_id, finding_id) values ($1, $2, $3)`, [ws, opp, pending]);
      }),
    ).rejects.toThrow(/findings aprobados/);
  });

  it("nacen candidatas; no se pueden crear aprobadas", async () => {
    await expect(
      asUser(pool, tano, (c) =>
        c.query(`insert into opportunities (workspace_id, title, status, stage) values ($1, 'X', 'aprobada', 'contacto_identificado')`, [ws]),
      ),
    ).rejects.toThrow(/nace como candidata/);
  });

  it("aprobar exige decisión y capacidad; el miembro sin capacidad no puede", async () => {
    const f = await newFinding(tano, "Operador abierto a asociarse");
    await asUser(pool, tano, (c) => c.query(`update findings set review_status = 'aprobado' where id = $1`, [f]), { commit: true });
    const { opp, decision } = await asUser(
      pool,
      member,
      async (c) => {
        const opp = (await c.query(`insert into opportunities (workspace_id, title, idempotency_key) values ($1, 'Asociación lavandería', 'idem-1') returning id`, [ws])).rows[0].id;
        await c.query(`insert into opportunity_findings (workspace_id, opportunity_id, finding_id) values ($1, $2, $3)`, [ws, opp, f]);
        const decision = (
          await c.query(`insert into decisions (workspace_id, opportunity_id, kind, question) values ($1, $2, 'aprobar_oportunidad', '¿Pasa a dealflow?') returning id`, [
            ws,
            opp,
          ])
        ).rows[0].id;
        return { opp, decision };
      },
      { commit: true },
    );

    // Cambiar el estado directamente, sin decisión, no se puede ni siquiera con capacidad.
    await expect(
      asUser(pool, fran, (c) => c.query(`update opportunities set status = 'aprobada', stage = 'contacto_identificado' where id = $1`, [opp])),
    ).rejects.toThrow(/falta la decisión/);
    // Un miembro sin capacidad no puede decidir.
    await expect(
      asUser(pool, member, (c) => c.query(`select public.decide_opportunity($1, 'approved', 'ok')`, [decision])),
    ).rejects.toThrow(/can_approve_decisions/);
    // Fran (admin con capacidad) aprueba: decisión + oportunidad en dealflow, atómico.
    await asUser(pool, fran, (c) => c.query(`select public.decide_opportunity($1, 'approved', 'Avanzar')`, [decision]), { commit: true });
    const o = (await pool.query(`select status, stage from opportunities where id = $1`, [opp])).rows[0];
    expect(o).toEqual({ status: "aprobada", stage: "contacto_identificado" });
    const d = (await pool.query(`select status, decided_by from decisions where id = $1`, [decision])).rows[0];
    expect(d).toEqual({ status: "approved", decided_by: fran.id });
    // Ya decidida: no se puede volver a decidir.
    await expect(
      asUser(pool, tano, (c) => c.query(`select public.decide_opportunity($1, 'rejected', 'no')`, [decision])),
    ).rejects.toThrow(/ya fue tomada/);
    // Idempotencia del alta: la misma clave no crea otra oportunidad.
    await expect(
      asUser(pool, member, (c) => c.query(`insert into opportunities (workspace_id, title, idempotency_key) values ($1, 'dup', 'idem-1')`, [ws])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("pausar o descartar en dealflow exige motivo", async () => {
    const { rows } = await pool.query(`select id from opportunities where workspace_id = $1 and status = 'aprobada' limit 1`, [ws]);
    await expect(
      asUser(pool, tano, (c) => c.query(`update opportunities set stage = 'descartada' where id = $1`, [rows[0].id])),
    ).rejects.toThrow(/check/);
  });

  it("un viewer ve todo pero no crea oportunidades ni decisiones; sí comenta", async () => {
    await expect(
      asUser(pool, viewer, (c) => c.query(`insert into opportunities (workspace_id, title) values ($1, 'X')`, [ws])),
    ).rejects.toThrow(/row-level security/);
    const n = await asUser(pool, viewer, async (c) => (await c.query(`select id from opportunities`)).rowCount);
    expect(n).toBeGreaterThan(0);
    const { rows } = await pool.query(`select id from decisions where workspace_id = $1 limit 1`, [ws]);
    await expect(
      asUser(pool, viewer, (c) => c.query(`insert into comments (workspace_id, decision_id, body) values ($1, $2, 'Comentario')`, [ws, rows[0].id])),
    ).resolves.toBeTruthy();
  });

  it("otro workspace no ve findings, oportunidades ni decisiones", async () => {
    const r = await asUser(pool, outsider, async (c) => ({
      f: (await c.query(`select id from findings where workspace_id = $1`, [ws])).rowCount,
      o: (await c.query(`select id from opportunities where workspace_id = $1`, [ws])).rowCount,
      d: (await c.query(`select id from decisions where workspace_id = $1`, [ws])).rowCount,
    }));
    expect(r).toEqual({ f: 0, o: 0, d: 0 });
  });
});

describe("tareas", () => {
  it("la misma clave de idempotencia no duplica la tarea creada desde un finding", async () => {
    const f = await newFinding(tano, "Pedir estados contables");
    await asUser(pool, tano, (c) => c.query(`update findings set review_status = 'aprobado' where id = $1`, [f]), { commit: true });
    const insert = (c: import("pg").PoolClient) =>
      c.query(`insert into tasks (workspace_id, title, finding_id, idempotency_key) values ($1, 'Pedir EECC', $2, $3)`, [ws, f, `finding:${f}`]);
    await asUser(pool, tano, insert, { commit: true });
    await expect(asUser(pool, tano, insert)).rejects.toThrow(/duplicate key/);
  });
});
