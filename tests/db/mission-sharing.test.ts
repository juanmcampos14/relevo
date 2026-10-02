// Colaboración mínima: la unidad que se comparte es la misión. Mismo Brain para quienes la comparten; lo de
// una misión privada no se ve desde otra (la inteligencia puede cruzar misiones, los permisos no). RLS real.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const pw = randomUUID();
const tag = randomUUID().slice(0, 8);
const people = { tano: `tano-${tag}@test.local`, fran: `fran-${tag}@test.local`, jenny: `jenny-${tag}@test.local` };
let ws: string, ids: Record<keyof typeof people, string>, db: Record<keyof typeof people, SupabaseClient<Database>>, vm: string, lao: string;

async function signIn(email: string) {
  const c = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Misiones");
  ids = {} as never;
  for (const [k, email] of Object.entries(people)) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    if (error) throw error;
    ids[k as keyof typeof people] = data.user.id;
  }
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [ws, ids.tano]);
  db = { tano: await signIn(people.tano), fran: await signIn(people.fran), jenny: await signIn(people.jenny) };
  // Tano crea dos misiones: nacen privadas (él es owner).
  vm = (await db.tano.from("campaigns").insert({ workspace_id: ws, name: "Vaca Muerta / Añelo", kind: "mision", status: "activa" }).select("id").single()).data!.id;
  lao = (await db.tano.from("campaigns").insert({ workspace_id: ws, name: "LAO", kind: "mision", status: "activa" }).select("id").single()).data!.id;
  const src = (await db.tano.from("sources").insert({ workspace_id: ws, kind: "observacion", title: "Prueba" }).select("id").single()).data!.id;
  await db.tano.from("findings").insert({ workspace_id: ws, source_id: src, kind: "observacion", statement: "Urgencias MRO obligan a salir de Añelo", campaign_id: vm });
  await db.tano.from("findings").insert({ workspace_id: ws, source_id: src, kind: "observacion", statement: "Local de vida sana del lado del río", campaign_id: lao });
  await db.tano.from("companies").insert({ workspace_id: ws, trade_name: "Inmobiliaria del Bajo", origin_campaign_id: lao });
  await db.tano.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "precio", section: "general", headline: "Local de 50 m² en el Bajo a $1,4 M", change: "nuevo", relevance: "alta", campaign_ids: [lao] } as never);
});
afterAll(async () => {
  await cleanup(pool, [ws], Object.entries(people).map(([k, email]) => ({ id: ids[k as keyof typeof people], email })));
  await pool.end();
});

describe("misiones compartidas", () => {
  it("invito a Fran a Vaca Muerta: entra por la invitación y ve el mismo Brain", async () => {
    const { error } = await db.tano.from("mission_invitations").insert({ workspace_id: ws, campaign_id: vm, email: people.fran, role: "member", invited_by: ids.tano });
    expect(error).toBeNull();
    await db.fran.rpc("accept_pending_invitations");
    const { data: missions } = await db.fran.from("campaigns").select("name");
    expect(missions!.map((m) => m.name)).toEqual(["Vaca Muerta / Añelo"]);
    const { data: f } = await db.fran.from("findings").select("statement");
    expect(f!.map((x) => x.statement)).toEqual(["Urgencias MRO obligan a salir de Añelo"]);
  });

  it("lo que aporta Fran lo ve Tano, con autoría", async () => {
    const { error } = await db.fran.from("evidence").insert({ workspace_id: ws, statement: "El encargado de FERRELEC confirmó que traen repuestos de Neuquén", evidence_type: "declaracion", origin_kind: "conversation", campaign_id: vm });
    expect(error).toBeNull();
    const { data } = await db.tano.from("evidence").select("statement, created_by").eq("campaign_id", vm);
    expect(data).toEqual([{ statement: "El encargado de FERRELEC confirmó que traen repuestos de Neuquén", created_by: ids.fran }]);
  });

  it("Fran no ve nada de LAO: ni la misión, ni sus hipótesis, ni lo que nació ahí, ni sus señales", async () => {
    expect((await db.fran.from("campaigns").select("id").eq("id", lao)).data).toEqual([]);
    expect((await db.fran.from("findings").select("id").eq("campaign_id", lao)).data).toEqual([]);
    expect((await db.fran.from("companies").select("id").eq("trade_name", "Inmobiliaria del Bajo")).data).toEqual([]);
    expect((await db.fran.from("brief_signals").select("id").eq("headline", "Local de 50 m² en el Bajo a $1,4 M")).data).toEqual([]);
    // Y no puede escribir en LAO.
    const { error } = await db.fran.from("evidence").insert({ workspace_id: ws, statement: "x", evidence_type: "dato", origin_kind: "conversation", campaign_id: lao });
    expect(error).not.toBeNull();
    // Tano sigue viendo LAO normalmente.
    expect((await db.tano.from("companies").select("id").eq("trade_name", "Inmobiliaria del Bajo")).data).toHaveLength(1);
  });

  it("Fran crea su misión: es privada hasta que la comparte", async () => {
    const own = (await db.fran.from("campaigns").insert({ workspace_id: ws, name: "Housing Añelo", kind: "mision", status: "activa" }).select("id").single()).data!.id;
    expect((await db.tano.from("campaigns").select("id").eq("id", own)).data).toEqual([]);
    const { error } = await db.fran.from("campaign_members").insert({ campaign_id: own, workspace_id: ws, user_id: ids.tano, role: "member", invited_by: ids.fran });
    expect(error).toBeNull();
    expect((await db.tano.from("campaigns").select("name").eq("id", own)).data).toEqual([{ name: "Housing Añelo" }]);
  });

  it("un viewer consulta pero no modifica la memoria compartida", async () => {
    await db.tano.from("mission_invitations").insert({ workspace_id: ws, campaign_id: vm, email: people.jenny, role: "viewer", invited_by: ids.tano });
    await db.jenny.rpc("accept_pending_invitations");
    expect((await db.jenny.from("findings").select("id").eq("campaign_id", vm)).data).toHaveLength(1);
    const { error } = await db.jenny.from("evidence").insert({ workspace_id: ws, statement: "x", evidence_type: "dato", origin_kind: "conversation", campaign_id: vm });
    expect(error).not.toBeNull();
    // Y solo el owner administra quién está.
    const { data } = await db.fran.from("campaign_members").delete().eq("campaign_id", vm).eq("user_id", ids.jenny).select("user_id");
    expect(data).toEqual([]);
  });

  it("ninguna foto de LAO es accesible para Fran: ni leerla ni pedir su link", async () => {
    const cap = (await pool.query(`insert into captures (workspace_id, client_id, captured_at, captured_by, campaign_id, body) values ($1, gen_random_uuid(), now(), $2, $3, 'Local en el Bajo') returning id`, [ws, ids.tano, lao])).rows[0].id as string;
    const path = `${ws}/${randomUUID()}/foto.jpg`;
    const up = await admin.storage.from("captures").upload(path, new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    expect(up.error).toBeNull();
    await pool.query(`insert into capture_media (workspace_id, capture_id, kind, storage_path, mime_type) values ($1, $2, 'photo', $3, 'image/jpeg')`, [ws, cap, path]);
    expect((await db.fran.storage.from("captures").createSignedUrl(path, 60)).data).toBeNull();
    expect((await db.fran.storage.from("captures").download(path)).data).toBeNull();
    expect((await db.tano.storage.from("captures").createSignedUrl(path, 60)).data?.signedUrl).toBeTruthy();
    await admin.storage.from("captures").remove([path]);
  });
});
