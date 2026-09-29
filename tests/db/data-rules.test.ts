// Reglas de honestidad de datos: nada "confirmado" sin fuente, precio sin fuente/fecha,
// coordenadas sin dirección verificada, teléfonos/emails sin procedencia, descarte sin motivo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, cleanup, createUser, createWorkspace, newPool, type TestUser } from "./harness";

const pool = newPool();
let ws: string, user: TestUser, sourceId: string, campaignId: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Reglas");
  user = await createUser(pool, "tano");
  await addMember(pool, ws, user, "owner", true);
  sourceId = (
    await pool.query(
      `insert into sources (workspace_id, kind, title, url) values ($1, 'url', 'Aviso', 'https://example.com/aviso') returning id`,
      [ws],
    )
  ).rows[0].id;
  campaignId = (await pool.query(`insert into campaigns (workspace_id, name) values ($1, 'C') returning id`, [ws])).rows[0].id;
});

afterAll(async () => {
  await cleanup(pool, [ws], [user]);
  await pool.end();
});

const run = (sql: string, params: unknown[]) => asUser(pool, user, (c) => c.query(sql, params));

describe("verificación y fuentes", () => {
  it("una empresa 'confirmada' exige fuente", async () => {
    await expect(
      run(`insert into companies (workspace_id, trade_name, verification_status) values ($1, 'X', 'confirmado')`, [ws]),
    ).rejects.toThrow(/check/);
    await expect(
      run(`insert into companies (workspace_id, trade_name, verification_status, source_id) values ($1, 'X', 'confirmado', $2)`, [
        ws,
        sourceId,
      ]),
    ).resolves.toBeTruthy();
  });

  it("rechaza estados de verificación fuera del catálogo", async () => {
    await expect(
      run(`insert into companies (workspace_id, trade_name, verification_status) values ($1, 'X', 'verificado')`, [ws]),
    ).rejects.toThrow(/check/);
  });

  it("un contacto con teléfono o email exige procedencia", async () => {
    await expect(
      run(`insert into contacts (workspace_id, full_name, phone) values ($1, 'Fede', '+54 299 000')`, [ws]),
    ).rejects.toThrow(/check/);
    await expect(run(`insert into contacts (workspace_id, full_name) values ($1, 'Fede')`, [ws])).resolves.toBeTruthy();
  });

  it("una fuente web exige URL y se deduplica por URL", async () => {
    await expect(run(`insert into sources (workspace_id, kind, title) values ($1, 'url', 'Sin URL')`, [ws])).rejects.toThrow(
      /check/,
    );
    await expect(
      run(`insert into sources (workspace_id, kind, title, url) values ($1, 'url', 'Dup', 'https://example.com/aviso')`, [ws]),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("ubicación y assets", () => {
  it("coordenadas sin dirección verificada, pero siempre con su estado de ubicación (V13 §12)", async () => {
    await expect(
      run(
        `insert into establishments (workspace_id, name, address_text, address_status, latitude, longitude)
         values ($1, 'Local', 'Ruta 7 km 1', 'no_verificada', -38.35, -68.79)`,
        [ws],
      ),
    ).rejects.toThrow(/check/);
    await expect(
      run(
        `insert into establishments (workspace_id, name, address_text, address_status, latitude, longitude, location_status)
         values ($1, 'Local', 'Ruta 7 km 1', 'no_verificada', -38.35, -68.79, 'unverified')`,
        [ws],
      ),
    ).resolves.toBeTruthy();
    await expect(
      run(
        `insert into establishments (workspace_id, name, address_text, address_status) values ($1, 'Local', 'Ruta 7 km 1', 'verificada')`,
        [ws],
      ),
    ).rejects.toThrow(/check/);
    await expect(
      run(
        `insert into establishments (workspace_id, name, address_text, address_status, location_source_id, latitude, longitude, location_status, location_verified_at)
         values ($1, 'Local', 'Ruta 7 km 1', 'verificada', $2, -38.35, -68.79, 'verified', now())`,
        [ws, sourceId],
      ),
    ).resolves.toBeTruthy();
  });

  it("dirección vacía no puede figurar como 'no_verificada' ni viceversa", async () => {
    await expect(
      run(`insert into establishments (workspace_id, name, address_status) values ($1, 'L', 'no_verificada')`, [ws]),
    ).rejects.toThrow(/check/);
  });

  it("el precio publicado de un asset exige moneda, fecha y fuente", async () => {
    await expect(
      run(`insert into assets (workspace_id, kind, title, price_amount, price_currency) values ($1, 'terreno', 'Lote', 100000, 'USD')`, [
        ws,
      ]),
    ).rejects.toThrow(/check/);
    await expect(
      run(
        `insert into assets (workspace_id, kind, operation, title, price_amount, price_currency, price_observed_on, price_source_id)
         values ($1, 'terreno', 'venta', 'Lote', 100000, 'USD', '2026-09-20', $2)`,
        [ws, sourceId],
      ),
    ).resolves.toBeTruthy();
  });
});

describe("targets", () => {
  it("un target apunta exactamente a una entidad y no se duplica en la campaña", async () => {
    await asUser(
      pool,
      user,
      async (c) => {
        const company = (await c.query(`insert into companies (workspace_id, trade_name) values ($1, 'T') returning id`, [ws])).rows[0].id;
        const asset = (await c.query(`insert into assets (workspace_id, kind, title) values ($1, 'local', 'Local') returning id`, [ws]))
          .rows[0].id;
        await c.query(`savepoint s`);
        await expect(
          c.query(`insert into campaign_targets (workspace_id, campaign_id, company_id, asset_id) values ($1, $2, $3, $4)`, [
            ws,
            campaignId,
            company,
            asset,
          ]),
        ).rejects.toThrow(/check/);
        await c.query(`rollback to savepoint s`);
        await c.query(`insert into campaign_targets (workspace_id, campaign_id, company_id) values ($1, $2, $3)`, [ws, campaignId, company]);
        await c.query(`savepoint s2`);
        await expect(
          c.query(`insert into campaign_targets (workspace_id, campaign_id, company_id) values ($1, $2, $3)`, [
            ws,
            campaignId,
            company,
          ]),
        ).rejects.toThrow(/duplicate key/);
        await c.query(`rollback to savepoint s2`);
      },
    );
  });

  it("descartar un target exige motivo", async () => {
    await asUser(pool, user, async (c) => {
      const company = (await c.query(`insert into companies (workspace_id, trade_name) values ($1, 'D') returning id`, [ws])).rows[0].id;
      await expect(
        c.query(`insert into campaign_targets (workspace_id, campaign_id, company_id, status) values ($1, $2, $3, 'descartado')`, [
          ws,
          campaignId,
          company,
        ]),
      ).rejects.toThrow(/check/);
    });
  });
});
