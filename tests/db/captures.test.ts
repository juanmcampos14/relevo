// Captura rápida: alta idempotente, aislamiento entre workspaces, archivos privados y ubicación sin verificar.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, cleanup, createUser, createWorkspace, newPool, type TestUser } from "./harness";

const pool = newPool();
let ws: string, wsB: string, tano: TestUser, viewer: TestUser, outsider: TestUser;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Capturas");
  wsB = await createWorkspace(pool, "Otro");
  tano = await createUser(pool, "tano");
  viewer = await createUser(pool, "viewer");
  outsider = await createUser(pool, "outsider");
  await addMember(pool, ws, tano, "owner", true);
  await addMember(pool, ws, viewer, "viewer");
  await addMember(pool, wsB, outsider, "owner", true);
});

afterAll(async () => {
  await cleanup(pool, [ws, wsB], [tano, viewer, outsider]);
  await pool.end();
});

function payload(clientId: string, extra: Record<string, unknown> = {}) {
  return {
    workspace_id: ws,
    client_id: clientId,
    body: "Proveedor nuevo frente a la YPF",
    captured_at: new Date().toISOString(),
    latitude: -38.35,
    longitude: -68.79,
    location_accuracy_m: 25,
    ai_consent: false,
    media: [{ kind: "audio", storage_path: `${ws}/${clientId}/a1.m4a`, mime_type: "audio/mp4", size_bytes: 1000, duration_ms: 4000 }],
    ...extra,
  };
}

const create = (user: TestUser, p: object) =>
  asUser(pool, user, async (c) => (await c.query(`select public.create_capture($1::jsonb) as id`, [JSON.stringify(p)])).rows[0].id as string, { commit: true });

describe("captura rápida", () => {
  it("reintentar la subida devuelve la misma captura y no duplica archivos", async () => {
    const clientId = randomUUID();
    const first = await create(tano, payload(clientId));
    const again = await create(tano, payload(clientId));
    expect(again).toBe(first);
    const { rows } = await pool.query(
      `select (select count(*) from captures where client_id = $1)::int as caps,
              (select count(*) from capture_media where capture_id = $2)::int as media,
              (select location_status from captures where id = $2) as loc,
              (select captured_by from captures where id = $2) as author`,
      [clientId, first],
    );
    expect(rows[0]).toEqual({ caps: 1, media: 1, loc: "gps_captured", author: tano.id });
  });

  it("una captura vacía se rechaza; solo texto o solo ubicación alcanzan", async () => {
    await expect(create(tano, payload(randomUUID(), { body: " ", latitude: null, longitude: null, media: [] }))).rejects.toThrow(/vacía/);
    await expect(create(tano, payload(randomUUID(), { latitude: null, longitude: null, media: [] }))).resolves.toBeTruthy();
    await expect(create(tano, payload(randomUUID(), { body: "", media: [] }))).resolves.toBeTruthy();
  });

  it("un viewer no captura y otro workspace no ve ni escribe", async () => {
    await expect(create(viewer, payload(randomUUID()))).rejects.toThrow(/row-level security/);
    await expect(create(outsider, payload(randomUUID()))).rejects.toThrow(/row-level security/);
    const seen = await asUser(pool, outsider, async (c) => (await c.query(`select id from captures where workspace_id = $1`, [ws])).rowCount);
    expect(seen).toBe(0);
  });

  it("un archivo no puede apuntar a la carpeta de otro workspace", async () => {
    const clientId = randomUUID();
    const p = payload(clientId, { media: [{ kind: "photo", storage_path: `${wsB}/${clientId}/f.jpg`, mime_type: "image/jpeg" }] });
    await expect(create(tano, p)).rejects.toThrow(/check constraint/);
  });

  it("archivos privados: solo miembros leen y solo editores suben en la carpeta de su workspace", async () => {
    const insert = (user: TestUser, path: string) =>
      asUser(pool, user, (c) => c.query(`insert into storage.objects (bucket_id, name, owner_id) values ('captures', $1, $2)`, [path, user.id]));
    await expect(insert(tano, `${ws}/${randomUUID()}/ok.jpg`)).resolves.toBeTruthy();
    await expect(insert(viewer, `${ws}/${randomUUID()}/no.jpg`)).rejects.toThrow(/row-level security/);
    await expect(insert(outsider, `${ws}/${randomUUID()}/no.jpg`)).rejects.toThrow(/row-level security/);
    await expect(insert(tano, `no-es-uuid/x.jpg`)).rejects.toThrow(/row-level security/);
  });
});

describe("ubicación sin verificar (V13 §12)", () => {
  it("un establecimiento acepta coordenadas GPS sin dirección verificada; 'verified' exige fecha de verificación", async () => {
    await asUser(pool, tano, async (c) => {
      await c.query(
        `insert into establishments (workspace_id, name, latitude, longitude, location_status, location_accuracy_m, location_source)
         values ($1, 'Proveedor sin dirección', -38.35, -68.79, 'gps_captured', 30, 'gps')`,
        [ws],
      );
      await expect(
        c.query(`insert into establishments (workspace_id, name, latitude, longitude, location_status) values ($1, 'x', -38.3, -68.7, 'verified')`, [ws]),
      ).rejects.toThrow(/establishments_location_verified/);
    });
    await expect(
      asUser(pool, tano, (c) => c.query(`insert into establishments (workspace_id, name, latitude, longitude) values ($1, 'y', -38.3, -68.7)`, [ws])),
    ).rejects.toThrow(/establishments_location_status_coords/);
  });
});
