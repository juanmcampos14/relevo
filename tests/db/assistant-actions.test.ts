// Acciones del asistente: proponer con vista previa (qué cambia, riesgo de duplicado), ejecutar solo
// con aprobación y dejar estado anterior/posterior. Tipos cerrados: no hay acción para promover oportunidades.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { ProposeActionInput, executeDraft, previewDraft } from "@/server/ai/drafts";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-asist-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
let ws: string, userId: string, db: SupabaseClient<Database>;
let companyId: string, findingId: string, evidenceId: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Asistente");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  const camp = (await pool.query(`insert into campaigns (workspace_id, name, status) values ($1, 'Añelo', 'activa') returning id`, [ws])).rows[0].id;
  companyId = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'PECOM') returning id`, [ws])).rows[0].id;
  await pool.query(`insert into campaign_targets (workspace_id, campaign_id, company_id, status, next_action) values ($1, $2, $3, 'investigacion', 'Llamar a recepción')`, [ws, camp, companyId]);
  const src = (await pool.query(`insert into sources (workspace_id, kind, title) values ($1, 'observacion', 'Captura') returning id`, [ws])).rows[0].id;
  findingId = (await pool.query(`insert into findings (workspace_id, source_id, kind, statement, origin) values ($1, $2, 'necesidad', 'Demanda de comida para contratistas', 'ia') returning id`, [ws, src])).rows[0].id;
  evidenceId = (await pool.query(`insert into evidence (workspace_id, statement, evidence_type, origin_kind, company_id) values ($1, 'Reintegran hasta $18.000 por comida', 'precio', 'conversation', $2) returning id`, [ws, companyId])).rows[0].id;
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("proponer → vista previa → aprobar → ejecutar con antes/después", () => {
  it("no existe una acción para promover oportunidades ni fusionar personas", () => {
    expect(ProposeActionInput.safeParse({ action: "promote_opportunity", rationale: "x", evidence_refs: [] }).success).toBe(false);
    expect(ProposeActionInput.safeParse({ action: "merge_contacts", rationale: "x", evidence_refs: [] }).success).toBe(false);
  });

  it("actualizar próxima acción: la vista previa muestra antes → después y la ejecución lo guarda", async () => {
    const p = ProposeActionInput.parse({ action: "update_next_action", entity_ref: `company:${companyId}`, next_action: "Identificar al decisor de alimentación", rationale: "Falta comprador", evidence_refs: [`evidence:${evidenceId}`] });
    const preview = await previewDraft(db, p);
    expect(preview.changes[0]).toMatchObject({ entity: "PECOM", field: "próxima acción", before: "Llamar a recepción", after: "Identificar al decisor de alimentación" });
    const res = await executeDraft(db, { workspaceId: ws, userId }, randomUUID(), p);
    expect(res).toMatchObject({ error: null, before: { next_action: "Llamar a recepción" }, after: { next_action: "Identificar al decisor de alimentación" } });
  });

  it("vincular evidencia en contra: avisa si ya estaba vinculada", async () => {
    const p = ProposeActionInput.parse({ action: "link_evidence", evidence_ref: `evidence:${evidenceId}`, finding_ref: `finding:${findingId}`, stance: "supports", rationale: "Techo de gasto", evidence_refs: [] });
    expect((await previewDraft(db, p)).duplicate_risk).toEqual([]);
    expect((await executeDraft(db, { workspaceId: ws, userId }, randomUUID(), p)).error).toBeNull();
    expect((await previewDraft(db, p)).duplicate_risk[0]).toMatch(/ya está vinculada/);
  });

  it("pedido de ayuda concreto y tarea con riesgo de duplicado", async () => {
    const help = ProposeActionInput.parse({ action: "request_help", assignee_ref: `member:${userId}`, help_kind: "introduccion", title: "Intro a compras de PECOM", finding_ref: `finding:${findingId}`, rationale: "Falta comprador", evidence_refs: [] });
    const res = await executeDraft(db, { workspaceId: ws, userId }, randomUUID(), help);
    expect(res.after).toMatchObject({ kind: "introduccion", ask: "Intro a compras de PECOM", status: "abierto" });

    const task = ProposeActionInput.parse({ action: "create_task", title: "Llamar a compras de PECOM", rationale: "x", evidence_refs: [] });
    await executeDraft(db, { workspaceId: ws, userId }, randomUUID(), task);
    expect((await previewDraft(db, { ...task, title: "Llamar a compras de PECOM mañana" })).duplicate_risk[0]).toMatch(/tarea parecida/);
  });
});
