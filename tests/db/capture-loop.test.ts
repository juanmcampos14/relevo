// Incremento C de punta a punta con RLS: captura → procesamiento (IA simulada) → propuestas →
// revisión humana (aceptar/editar/rechazar) → objetos RELEVO → trazabilidad hasta la captura.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { Extraction } from "@/server/capture/extract";
import { processCapture } from "@/server/capture/process";
import { decideProposal } from "@/server/capture/promote";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-captura-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
const settings = { ai_processing_consent: true, freshness_days: { capacidad: 90 } };
let ws: string, userId: string, db: SupabaseClient<Database>, captureId: string, existingFinding: string;

const NOTE = "Hablé con el encargado de una empresa. Tienen 35 camionetas y mandan 8 por semana a Neuquén porque no consiguen resolver determinados mantenimientos en Añelo. Me pasó el contacto de Laura de Compras.";

let extraction: Extraction;
let calls = 0;
const fakeClient = {
  beta: {
    messages: {
      parse: async () => {
        calls++;
        return { stop_reason: "end_turn", parsed_output: extraction, usage: { input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 800 } };
      },
    },
  },
} as unknown as Anthropic;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Captura");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  const camp = (await pool.query(`insert into campaigns (workspace_id, name, status) values ($1, 'Añelo', 'activa') returning id`, [ws])).rows[0].id;
  const src = (await pool.query(`insert into sources (workspace_id, kind, title) values ($1, 'observacion', 'Nota') returning id`, [ws])).rows[0].id;
  existingFinding = (await pool.query(`insert into findings (workspace_id, source_id, kind, statement) values ($1, $2, 'necesidad', 'Las flotas resuelven todo el mantenimiento en Añelo') returning id`, [ws, src])).rows[0].id;
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
  const { data: id, error: e2 } = await db.rpc("create_capture", {
    p: { workspace_id: ws, client_id: randomUUID(), body: NOTE, captured_at: "2026-10-17T14:30:00-03:00", latitude: -38.35, longitude: -68.79, location_accuracy_m: 20, campaign_id: camp, ai_consent: true, media: [] },
  });
  if (e2) throw e2;
  captureId = id as string;
  extraction = {
    summary: "Empresa de flota en Añelo deriva mantenimiento a Neuquén.",
    company: { name: "Empresa X", identified: true, existing_id: null, resolves: null, locality: "Añelo", activity: "Flota de camionetas" },
    asset: null,
    people: [
      { key: "p1", name: null, role: "Encargado", institutional: true, existing_id: null, resolves: null },
      { key: "p2", name: "Laura", role: "Compras", institutional: false, existing_id: null, resolves: null },
    ],
    evidence: [
      { key: "e1", statement: "Tienen 35 camionetas", quote: "Tienen 35 camionetas", evidence_type: "capacidad", origin: "declarado_por_persona", declared_by: null, stated_by: "p1", about: "company" as const },
      { key: "e2", statement: "Mandan 8 camionetas por semana a Neuquén por mantenimientos que no resuelven en Añelo", quote: "mandan 8 por semana a Neuquén", evidence_type: "dato", origin: "declarado_por_persona", declared_by: null, stated_by: "p1", about: "company" as const },
      { key: "e3", statement: "El encargado parecía apurado", quote: null, evidence_type: "observacion", origin: "observado", declared_by: null, stated_by: null, about: "company" as const },
    ],
    finding_candidates: [
      { statement: "Posible falta de capacidad de mantenimiento de flotas en Añelo", existing_finding_id: null, relation: "nueva", refined_statement: null, is_idea: false, kind: "necesidad", rationale: "Una empresa deriva 8 unidades por semana; falta un segundo caso.", supports: ["e1", "e2"], contradicts: [] },
      // Contraevidencia contra una hipótesis existente: se suma ahí (no crea otra).
      { statement: "Los talleres de Añelo alcanzan", existing_finding_id: existingFinding, relation: "contradice", refined_statement: null, is_idea: false, kind: "observacion", rationale: "Deriva unidades a Neuquén.", supports: [], contradicts: ["e2"] },
    ],
    unknowns: ["Frecuencia real de derivaciones", "Quién decide la compra"],
    next_actions: [{ title: "Hablar con Laura (Compras) sobre frecuencia, gasto y proceso de compra", why: "Validar el costo del traslado", contact: "p2", due: null }],
  };
});

afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

const proposals = async () =>
  ((await db.from("proposals").select("id, kind, status, payload, quote, result_id, result_type").eq("capture_id", captureId).order("position")).data ?? []);
const decide = (proposalId: string, action: "aceptar" | "rechazar", edits?: Record<string, unknown>) =>
  decideProposal(db, { workspaceId: ws, settings, userId, proposalId, decision: { action, edits } });

describe("captura → propuestas → revisión → objetos", () => {
  it("sin consentimiento del workspace no se procesa ni se llama a la IA", async () => {
    const res = await processCapture(db, { workspaceId: ws, settings: {}, userId, captureId, client: fakeClient });
    expect(res).toMatchObject({ ok: false });
    expect(calls).toBe(0);
  });

  it("procesar deja propuestas revisables (no escribe objetos) y registra la corrida", async () => {
    const res = await processCapture(db, { workspaceId: ws, settings, userId, captureId, client: fakeClient });
    expect(res).toEqual({ ok: true, proposals: 9 });
    const ps = await proposals();
    expect(ps.map((p) => p.kind)).toEqual(["company", "person", "person", "evidence", "evidence", "evidence", "finding", "finding", "next_action"]);
    expect(ps.every((p) => p.status === "propuesta")).toBe(true);
    expect(ps[3].quote).toBe("Tienen 35 camionetas");
    const { count } = await db.from("companies").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
    const { data: cap } = await db.from("captures").select("status, ai_summary, ai_run_id, body, ai_unknowns").eq("id", captureId).single();
    expect(cap).toMatchObject({ status: "propuestas_listas", body: NOTE, ai_unknowns: ["Frecuencia real de derivaciones", "Quién decide la compra"] });
    const { data: run } = await db.from("ai_runs").select("status, input_tokens, cost_usd").eq("id", cap!.ai_run_id!).single();
    expect(run).toMatchObject({ status: "ok", input_tokens: 1200 });
  });

  it("no se procesa dos veces", async () => {
    expect(await processCapture(db, { workspaceId: ws, settings, userId, captureId, client: fakeClient })).toMatchObject({ ok: false, message: /ya tiene propuestas/ });
    expect(calls).toBe(1);
  });

  it("las dependencias se deciden en orden: primero la empresa", async () => {
    const ps = await proposals();
    expect(await decide(ps[1].id, "aceptar")).toMatchObject({ ok: false, message: /Primero decidí la empresa/ });
  });

  it("aceptar / editar / rechazar crea solo lo aceptado, con trazabilidad a la captura", async () => {
    let ps = await proposals();
    expect(await decide(ps[0].id, "aceptar")).toMatchObject({ ok: true });
    expect(await decide(ps[1].id, "aceptar")).toMatchObject({ ok: true });
    expect(await decide(ps[2].id, "aceptar", { name: "Laura Gómez" })).toMatchObject({ ok: true });
    expect(await decide(ps[3].id, "aceptar")).toMatchObject({ ok: true });
    expect(await decide(ps[4].id, "aceptar")).toMatchObject({ ok: true, message: /contradice/ });
    expect(await decide(ps[5].id, "rechazar")).toMatchObject({ ok: true });
    expect(await decide(ps[6].id, "aceptar")).toMatchObject({ ok: true, message: /2 evidencias/ });
    expect(await decide(ps[7].id, "aceptar")).toMatchObject({ ok: true, message: /hipótesis existente/ });
    expect(await decide(ps[8].id, "aceptar")).toMatchObject({ ok: true });
    expect(await decide(ps[8].id, "aceptar")).toMatchObject({ ok: false, message: /ya se decidió/ });

    ps = await proposals();
    expect(ps.map((p) => p.status)).toEqual(["aceptada", "aceptada", "editada", "aceptada", "aceptada", "rechazada", "aceptada", "aceptada", "aceptada"]);
    const companyId = ps[0].result_id!;

    const { data: target } = await db.from("campaign_targets").select("status, owner_id").eq("company_id", companyId).single();
    expect(target).toEqual({ status: "investigacion", owner_id: userId });
    const { data: people } = await db.from("contacts").select("full_name, contact_kind, contact_links(company_id)").order("full_name");
    expect(people).toEqual([
      { full_name: "Encargado", contact_kind: "canal_institucional", contact_links: [{ company_id: companyId }] },
      { full_name: "Laura Gómez", contact_kind: "persona", contact_links: [{ company_id: companyId }] },
    ]);

    const { data: ev } = await db.from("evidence").select("id, statement, quote, verification_status, origin_kind, capture_id, company_id, stated_by_contact_id, revalidate_after").order("statement");
    expect(ev).toHaveLength(2);
    expect(ev!.every((e) => e.capture_id === captureId && e.company_id === companyId && e.stated_by_contact_id === ps[1].result_id)).toBe(true);
    expect(ev!.find((e) => e.statement.startsWith("Tienen"))).toMatchObject({ quote: "Tienen 35 camionetas", verification_status: "unverified", origin_kind: "conversation", revalidate_after: "2027-01-15" });

    // Contraevidencia contra el finding existente + finding nuevo con su evidencia a favor.
    const { rows: fe } = await pool.query(`select finding_id = $1 as existing, stance from finding_evidence where evidence_id = any($2::uuid[]) order by 1, 2`, [existingFinding, ev!.map((e) => e.id)]);
    expect(fe).toEqual([{ existing: false, stance: "supports" }, { existing: false, stance: "supports" }, { existing: true, stance: "contradicts" }]);
    const { data: finding } = await db.from("findings").select("statement, review_status, origin, company_id, sources(kind, reference)").eq("id", ps[6].result_id!).single();
    expect(finding).toMatchObject({ review_status: "aprobado", origin: "ia", company_id: companyId, sources: { kind: "observacion", reference: `captura:${captureId}` } });
    const { data: maturity } = await db.from("findings").select("maturity").eq("id", ps[6].result_id!).single();
    expect(maturity!.maturity).toBe("hipotesis");

    const { data: task } = await db.from("tasks").select("title, assignee_id, contact_id, target_id").eq("id", ps[8].result_id!).single();
    expect(task).toMatchObject({ assignee_id: userId, contact_id: ps[2].result_id });
    expect(task!.target_id).not.toBeNull();

    const { data: cap } = await db.from("captures").select("status").eq("id", captureId).single();
    expect(cap!.status).toBe("revisado");
  });

  it("vincular con una empresa existente no crea otra", async () => {
    const { data: other } = await db.rpc("create_capture", { p: { workspace_id: ws, client_id: randomUUID(), body: "Volví a Empresa X, siguen mandando camionetas a Neuquén.", captured_at: new Date().toISOString(), ai_consent: true, media: [] } });
    extraction = { ...extraction, company: { name: "Empresa X", identified: true, existing_id: null, resolves: null, locality: "Añelo", activity: null }, people: [], evidence: [], finding_candidates: [], next_actions: [] };
    await processCapture(db, { workspaceId: ws, settings, userId, captureId: other as string, client: fakeClient });
    const { data: ps } = await db.from("proposals").select("id, matches").eq("capture_id", other as string);
    const match = (ps![0].matches as { id: string }[])[0];
    expect(match).toBeTruthy();
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps![0].id, decision: { action: "aceptar", edits: { link_to: match.id } } })).toMatchObject({ ok: true, resultId: match.id });
    const { count } = await db.from("companies").select("id", { count: "exact", head: true });
    expect(count).toBe(1);
  });
});
