// Prueba real del 29/09 (local en alquiler): activo propuesto + datos agrupados + semántica observado/declarado/verificado.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { Extraction } from "@/server/capture/extract";
import { processCapture } from "@/server/capture/process";
import { acceptGroup } from "@/server/capture/promote";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-local-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
const settings = { ai_processing_consent: true };
let ws: string, userId: string, db: SupabaseClient<Database>, captureId: string;

const NOTE = "Local en alquiler en Los Algarrobos, cartel en la vidriera: 35 m², 5 x 7.";
const extraction: Extraction = {
  summary: "Local comercial en alquiler en Los Algarrobos.",
  company: null,
  asset: { title: "Local comercial en Los Algarrobos", kind: "local", operation: "alquiler", address_text: "Los Algarrobos", locality: "Añelo", surface_m2: 35 },
  people: [],
  evidence: [
    { key: "e1", statement: "Se observó un cartel de alquiler en la vidriera", quote: "cartel en la vidriera", evidence_type: "observacion", origin: "observado", stated_by: null, declared_by: null, about: "asset" },
    { key: "e2", statement: "Superficie de 35 m²", quote: "35 m²", evidence_type: "dato", origin: "declarado_por_documento", stated_by: null, declared_by: "cartel de alquiler en la vidriera", about: "asset" },
    { key: "e3", statement: "Medidas de 5 x 7 m", quote: "5 x 7", evidence_type: "dato", origin: "declarado_por_documento", stated_by: null, declared_by: "cartel de alquiler en la vidriera", about: "asset" },
  ],
  finding_candidates: [],
  unknowns: [],
  next_actions: [],
};
const fakeClient = { beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: extraction, usage: { input_tokens: 1, output_tokens: 1 } }) } } } as unknown as Anthropic;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Local");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  await pool.query(`insert into campaigns (workspace_id, name, status) values ($1, 'Añelo', 'activa')`, [ws]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
  const camp = (await pool.query(`select id from campaigns where workspace_id = $1`, [ws])).rows[0].id;
  const { data: id } = await db.rpc("create_capture", {
    p: { workspace_id: ws, client_id: randomUUID(), body: NOTE, captured_at: new Date().toISOString(), latitude: -38.3539, longitude: -68.7883, location_accuracy_m: 12, campaign_id: camp, ai_consent: true, media: [] },
  });
  captureId = id as string;
});

afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("activo propuesto y datos agrupados", () => {
  it("un activo con sus datos: 4 propuestas, revisables como un grupo", async () => {
    expect(await processCapture(db, { workspaceId: ws, settings, userId, captureId, client: fakeClient, transcriber: null })).toEqual({ ok: true, proposals: 4 });
    const res = await acceptGroup(db, { workspaceId: ws, settings, userId, captureId, subject: "asset" });
    expect(res).toMatchObject({ accepted: 4, skipped: [] });
  });

  it("el activo toma la ubicación GPS de la captura, sin verificar, y entra a la misión", async () => {
    const { data: asset } = await db.from("assets").select("id, title, kind, operation, surface_m2, location_status, latitude, address_status").single();
    expect(asset).toMatchObject({ title: "Local comercial en Los Algarrobos", kind: "local", operation: "alquiler", surface_m2: 35, location_status: "gps_captured", latitude: -38.3539, address_status: "no_verificada" });
    const { count } = await db.from("campaign_targets").select("id", { count: "exact", head: true }).eq("asset_id", asset!.id);
    expect(count).toBe(1);
  });

  it("observé ≠ el cartel dice ≠ verifiqué", async () => {
    const { data: ev } = await db.from("evidence").select("statement, verification_status, origin_kind, declared_by, asset_id").order("statement");
    expect(ev!.map((e) => [e.statement, e.verification_status, e.origin_kind, e.declared_by])).toEqual([
      ["Medidas de 5 x 7 m", "unverified", "field", "cartel de alquiler en la vidriera"],
      ["Se observó un cartel de alquiler en la vidriera", "field_verified", "field", null],
      ["Superficie de 35 m²", "unverified", "field", "cartel de alquiler en la vidriera"],
    ]);
    expect(ev!.every((e) => e.asset_id)).toBe(true);
  });
});
