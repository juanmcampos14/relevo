// Modelo canónico (docs/04-modelo-canonico.md): evidencia, contraevidencia, activos con rol, procedencia y etapas CRM.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, cleanup, createUser, createWorkspace, newPool, type TestUser } from "./harness";

const pool = newPool();
let ws: string, tano: TestUser, company: string, asset: string, finding: string, source: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[]) =>
  asUser(pool, tano, async (c) => (await c.query(sql, params)).rows[0] as T, { commit: true });

beforeAll(async () => {
  ws = await createWorkspace(pool, "Modelo");
  tano = await createUser(pool, "tano");
  await addMember(pool, ws, tano, "owner", true);
  source = (await one<{ id: string }>(`insert into sources (workspace_id, kind, title, url) values ($1, 'url', 'Ficha pública', 'https://example.com/ficha') returning id`, [ws])).id;
  company = (await one<{ id: string }>(`insert into companies (workspace_id, trade_name) values ($1, 'Empresa X') returning id`, [ws])).id;
  asset = (await one<{ id: string }>(`insert into assets (workspace_id, kind, operation, title) values ($1, 'inmueble', 'venta', 'Hotel en venta') returning id`, [ws])).id;
  finding = (await one<{ id: string }>(`insert into findings (workspace_id, source_id, kind, statement) values ($1, $2, 'necesidad', 'Puede faltar alojamiento flexible') returning id`, [ws, source])).id;
});

afterAll(async () => {
  await cleanup(pool, [ws], [tano]);
  await pool.end();
});

describe("evidencia", () => {
  it("nace sin verificar; verificada solo con fuente, captura o visita", async () => {
    const e = await one<{ verification_status: string }>(`insert into evidence (workspace_id, statement, origin_kind, company_id) values ($1, 'Tienen 40 camionetas', 'conversation', $2) returning verification_status`, [ws, company]);
    expect(e.verification_status).toBe("unverified");
    await expect(one(`insert into evidence (workspace_id, statement, origin_kind, verification_status) values ($1, 'x', 'manual', 'field_verified')`, [ws])).rejects.toThrow(/check constraint/);
    await expect(one(`insert into evidence (workspace_id, statement, origin_kind, verification_status, source_id) values ($1, 'x', 'website', 'publicly_verified', $2) returning id`, [ws, source])).resolves.toBeTruthy();
  });

  it("el catálogo viejo ya no se acepta", async () => {
    await expect(one(`insert into companies (workspace_id, trade_name, verification_status) values ($1, 'Y', 'hipotesis')`, [ws])).rejects.toThrow(/check constraint/);
  });

  it("contraevidencia: la misma finding puede tener evidencia a favor y en contra", async () => {
    const a = (await one<{ id: string }>(`insert into evidence (workspace_id, statement, origin_kind) values ($1, 'No consiguieron 20 camas para una cuadrilla', 'conversation') returning id`, [ws])).id;
    const b = (await one<{ id: string }>(`insert into evidence (workspace_id, statement, origin_kind) values ($1, 'El hotel tiene capacidad ociosa', 'field') returning id`, [ws])).id;
    await one(`insert into finding_evidence (workspace_id, finding_id, evidence_id, stance) values ($1, $2, $3, 'supports'), ($1, $2, $4, 'contradicts') returning finding_id`, [ws, finding, a, b]);
    const { rows } = await pool.query(`select stance, count(*)::int n from finding_evidence where finding_id = $1 group by stance order by stance`, [finding]);
    expect(rows).toEqual([{ stance: "contradicts", n: 1 }, { stance: "supports", n: 1 }]);
    await expect(one(`insert into finding_evidence (workspace_id, finding_id, evidence_id, stance) values ($1, $2, $3, 'confirma')`, [ws, finding, a])).rejects.toThrow(/check constraint/);
  });
});

describe("activos con rol", () => {
  it("una empresa puede ser intermediaria sin ser propietaria; rol verificado exige evidencia", async () => {
    await one(`insert into asset_parties (workspace_id, asset_id, company_id, role) values ($1, $2, $3, 'intermediario') returning id`, [ws, asset, company]);
    const { rows } = await pool.query(`select role from asset_parties where asset_id = $1`, [asset]);
    expect(rows.map((r) => r.role)).toEqual(["intermediario"]);
    await expect(one(`insert into asset_parties (workspace_id, asset_id, company_id, role, verification_status) values ($1, $2, $3, 'propietario', 'publicly_verified')`, [ws, asset, company])).rejects.toThrow(/check constraint/);
  });
});

describe("procedencia y etapas", () => {
  it("un ID del CRM apunta a una sola entidad por tipo", async () => {
    await one(`insert into external_refs (workspace_id, source_system, external_id, entity_type, entity_id) values ($1, 'google_sheets', 'AN-0023', 'company', $2) returning id`, [ws, company]);
    await expect(one(`insert into external_refs (workspace_id, source_system, external_id, entity_type, entity_id) values ($1, 'google_sheets', 'AN-0023', 'company', gen_random_uuid())`, [ws])).rejects.toThrow(/duplicate key/);
  });

  it("los objetivos usan las etapas del CRM", async () => {
    const camp = (await one<{ id: string }>(`insert into campaigns (workspace_id, name) values ($1, 'Añelo') returning id`, [ws])).id;
    const t = await one<{ status: string }>(`insert into campaign_targets (workspace_id, campaign_id, company_id) values ($1, $2, $3) returning status`, [ws, camp, company]);
    expect(t.status).toBe("investigacion");
    await expect(one(`update campaign_targets set status = 'visitado' where campaign_id = $1`, [camp])).rejects.toThrow(/check constraint/);
  });
});
