// El Brain aprende de lo que le dicen y de lo que encuentra, sin borrar historia y en la misión correcta.
// Caso real: "Nicolás Raviola ya no trabaja en Pecom". RLS real (member).
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { applyRelationship, undoRelationship } from "@/server/ai/relationships";
import { ingestDiscovery } from "@/server/mission/ingest";
import { setAside, undoSetAside } from "@/server/ai/set-aside";
import { missionCounts, missionPeople, opportunitiesView } from "@/server/surface";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-brain-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
let ws: string, userId: string, db: SupabaseClient<Database>, vm: string, zn: string, pecom: string, nicolas: string, outreach: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Brain");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'member')`, [ws, userId]);
  const q = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
  vm = await q(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'Vaca Muerta / Añelo', 'mision', 'activa') returning id`, [ws]);
  zn = await q(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'Locales Zona Norte', 'mision', 'activa') returning id`, [ws]);
  pecom = await q(`insert into companies (workspace_id, trade_name) values ($1, 'PECOM') returning id`, [ws]);
  nicolas = await q(`insert into contacts (workspace_id, full_name, role_title) values ($1, 'Nicolas Raviola', 'Compras / Abastecimiento · PECOM') returning id`, [ws]);
  await pool.query(`insert into contact_links (workspace_id, contact_id, company_id) values ($1, $2, $3)`, [ws, nicolas, pecom]);
  const target = await q(`insert into campaign_targets (workspace_id, campaign_id, company_id) values ($1, $2, $3) returning id`, [ws, vm, pecom]);
  outreach = await q(`insert into tasks (workspace_id, title, status, contact_id, target_id, campaign_id) values ($1, 'Contactar a Nicolás para pedir reunión', 'todo', $2, $3, $4) returning id`, [ws, nicolas, target, vm]);
  const src = await q(`insert into sources (workspace_id, kind, title) values ($1, 'observacion', 'Prueba') returning id`, [ws]);
  await pool.query(`insert into findings (workspace_id, source_id, kind, statement, campaign_id) values ($1, $2, 'observacion', 'Urgencias MRO obligan a salir de Añelo', $3)`, [ws, src, vm]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("el Brain aprende sin borrar historia", () => {
  it("'ya no trabaja en Pecom': relación anterior con evidencia, deja de recomendarlo, abre buscar reemplazo; deshacer vuelve todo", async () => {
    const r = await applyRelationship(db, { workspaceId: ws, userId, userName: "Tano", campaignId: vm }, { change: "ya_no_esta", contact_ref: `contact:${nicolas}`, company_ref: `company:${pecom}`, note: "lo vi en LinkedIn" });
    const { data: link } = await db.from("contact_links").select("valid_until, ended_note, role_title, ended_evidence_id").eq("contact_id", nicolas).single();
    expect(link).toMatchObject({ ended_note: "lo vi en LinkedIn", role_title: "Compras / Abastecimiento · PECOM" });
    expect(link!.valid_until).not.toBeNull();
    const { data: ev } = await db.from("evidence").select("statement, campaign_id").eq("id", link!.ended_evidence_id!).single();
    expect(ev).toMatchObject({ campaign_id: vm });
    expect(ev!.statement).toContain("ya no trabaja en PECOM");
    // Ya no se recomienda: las personas vigentes de PECOM no lo incluyen; la historia sigue.
    const { data: vigentes } = await db.from("contact_links").select("contact_id").eq("company_id", pecom).is("valid_until", null);
    expect(vigentes).toEqual([]);
    expect((await db.from("contacts").select("role_title").eq("id", nicolas).single()).data!.role_title).toMatch(/^Antes:/);
    expect((await db.from("tasks").select("status").eq("id", outreach).single()).data!.status).toBe("done");
    expect((await db.from("tasks").select("title, campaign_id").eq("id", r.effects.created_task!).single()).data).toMatchObject({ title: expect.stringContaining("reemplaza a Nicolas Raviola en PECOM"), campaign_id: vm });
    // Cambiar de trabajo no saca a nadie de la memoria: sigue contando entre las personas de la misión.
    const people = await missionPeople(db, vm);
    expect(people.find((p) => p.id === nicolas)?.links).toEqual([{ with: "PECOM", current: false, until: expect.any(String) }]);
    expect((await missionCounts(db, vm)).people).toBe(1);
    await undoRelationship(db, nicolas, r.effects);
    const { data: back } = await db.from("contact_links").select("valid_until").eq("contact_id", nicolas).single();
    expect(back!.valid_until).toBeNull();
    expect((await db.from("tasks").select("status").eq("id", outreach).single()).data!.status).toBe("todo");
    expect((await db.from("evidence").select("id").eq("id", r.effects.evidence_id!)).data).toEqual([]);
  });

  it("lo que encuentra: lo claro entra solo a la misión, lo que ya existe se vincula, lo parecido pregunta", async () => {
    // Como la vigilancia (cron, sin usuario).
    const r = await ingestDiscovery(admin, { workspaceId: ws, missionId: vm }, [
      { kind: "empresa", name: "Contratista Nueva SRL", detail: "Entra a Añelo con 40 personas", company: "", maybe: "" },
      { kind: "empresa", name: "Pecom", detail: "Vuelve a aparecer", company: "", maybe: "" },
      { kind: "empresa", name: "PECOM Servicios Energía", detail: "¿La misma?", company: "", maybe: "" },
    ]);
    expect(r).toEqual({ ingested: 1, questions: 1 });
    const { data: nueva } = await db.from("companies").select("id, verification_status").eq("trade_name", "Contratista Nueva SRL").single();
    expect(nueva!.verification_status).toBe("unverified");
    expect((await db.from("campaign_targets").select("id").eq("campaign_id", vm).eq("company_id", nueva!.id)).data).toHaveLength(1);
    const { data: q } = await db.from("brief_candidates").select("question, campaign_id").eq("campaign_id", vm).eq("status", "candidato");
    expect(q![0].question).toContain("PECOM");
  });

  it("cada misión ve lo suyo: hipótesis y empresas de Vaca Muerta no aparecen en Zona Norte", async () => {
    const [a, b] = await Promise.all([missionCounts(db, vm), missionCounts(db, zn)]);
    expect(a.companies).toBeGreaterThan(0);
    expect(a.hypotheses).toBe(1);
    expect(b).toEqual({ companies: 0, people: 0, assets: 0, hypotheses: 0, evidence: 0, signals: 0 });
    expect((await opportunitiesView(db, zn)).closest).toEqual([]);
  });

  it("'sacá ese terreno': sale de la misión sin borrarse (con el motivo) y se puede deshacer", async () => {
    const asset = (await pool.query(`insert into assets (workspace_id, kind, title) values ($1, 'terreno', 'Terreno 150 m² sobre ruta') returning id`, [ws])).rows[0].id as string;
    await pool.query(`insert into campaign_targets (workspace_id, campaign_id, asset_id) values ($1, $2, $3)`, [ws, vm, asset]);
    const before = (await missionCounts(db, vm)).assets;
    const r = await setAside(db, { workspaceId: ws, missionId: vm }, `asset:${asset}`, "no es el terreno que buscamos");
    expect((await missionCounts(db, vm)).assets).toBe(before - 1);
    expect((await db.from("assets").select("id").eq("id", asset)).data).toHaveLength(1);
    expect((await db.from("campaign_targets").select("status, discard_reason").eq("asset_id", asset).single()).data).toEqual({ status: "descartado", discard_reason: "no es el terreno que buscamos" });
    await undoSetAside(db, ws, r.effects);
    expect((await missionCounts(db, vm)).assets).toBe(before);
  });
});
