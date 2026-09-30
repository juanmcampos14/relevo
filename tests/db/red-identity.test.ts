// Red / CRM: el importador y las capturas terminan en el mismo registro, sin duplicar personas ni empresas.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { RawRow } from "@/domain/crm-import/map";
import type { ParsedWorkbook } from "@/server/crm-import/parse";
import type { Extraction } from "@/server/capture/extract";
import { stageImport } from "@/server/crm-import/stage";
import { applyBatch } from "@/server/crm-import/apply";
import { decideRow } from "@/server/crm-import/review";
import { processCapture } from "@/server/capture/process";
import { decideProposal } from "@/server/capture/promote";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, userId: string, db: SupabaseClient<Database>;
const email = `tano-red-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
const settings = { ai_processing_consent: true };
const r = (sheet: string, row: number, values: Record<string, string | null>): RawRow => ({ sheet, row, values });
const workbook: ParsedWorkbook = {
  formulaIds: [],
  rows: {
    companies: [r("EMPRESAS", 10, { "ID anterior": "AN-8001", ID: "AN-8001", "Empresa / establecimiento": "Viandas del Sur", Sector: "Alimentación", "Localidad / zona": "Añelo", Prioridad: "Alta", Responsable: "Tano" })],
    contacts: [r("RED | CONTACTOS", 5, { ID: "CT-8001", Nombre: "Laura Gómez", "Empresa ID": "AN-8001", Cargo: "Compras", Correo: "laura@viandas.example" })],
    tasks: [],
    sources: [],
  },
};

beforeAll(async () => {
  ws = await createWorkspace(pool, "Red");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  await pool.query(`insert into campaigns (workspace_id, name, status) values ($1, 'Añelo', 'activa')`, [ws]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

let lauraFromField: string, companyId: string;

describe("una persona que llegó de campo y después aparece en el CRM", () => {
  it("el importador la detecta y, al confirmar, vincula el ID del CRM a la misma persona (sin duplicar)", async () => {
    const { data: laura } = await db.from("contacts").insert({ workspace_id: ws, full_name: "Laura Gomez", contact_kind: "persona", role_title: "Compras", notes: "De una captura de campo." }).select("id").single();
    lauraFromField = laura!.id;

    const batch = await stageImport(db, ws, workbook, { fileName: "crm.xlsx", sha256: "r1" });
    const { data: rows } = await db.from("import_rows").select("id, entity_type, issues").eq("batch_id", batch);
    const contactRow = rows!.find((x) => x.entity_type === "contact")!;
    const issues = contactRow.issues as { code: string; proposal?: { patch: { _link_to?: string } } }[];
    const dup = issues.findIndex((i) => i.code === "posible_duplicado");
    expect(dup).toBeGreaterThanOrEqual(0);
    expect(issues[dup].proposal!.patch._link_to).toBe(lauraFromField);

    for (const row of rows!) {
      const res = await decideRow(db, row.id, "aprobada", row.id === contactRow.id ? { issues: { [dup]: "aplicar" } } : {}, userId);
      expect(res.error).toBeUndefined();
    }
    expect((await applyBatch(db, ws, batch)).errors).toEqual([]);

    const { data: people } = await db.from("contacts").select("id, full_name, email");
    expect(people).toEqual([{ id: lauraFromField, full_name: "Laura Gomez", email: null }]); // no se pisan sus datos
    const { data: ref } = await db.from("external_refs").select("entity_id").eq("external_id", "CT-8001").single();
    expect(ref!.entity_id).toBe(lauraFromField);
    const { data: c } = await db.from("external_refs").select("entity_id").eq("external_id", "AN-8001").single();
    companyId = c!.entity_id;
    const { data: links } = await db.from("contact_links").select("company_id").eq("contact_id", lauraFromField);
    expect(links).toEqual([{ company_id: companyId }]);
  });
});

describe("una captura posterior enriquece la empresa importada", () => {
  it("propone vincular con la empresa del CRM y la evidencia queda en esa ficha, sin crear otra", async () => {
    const extraction: Extraction = {
      summary: "Visita a Viandas del Sur.",
      company: { name: "Viandas del Sur", identified: true, existing_id: null, resolves: null, locality: "Añelo", activity: "Viandas" },
      asset: null,
      people: [],
      evidence: [{ key: "e1", statement: "Entregan 400 viandas por día", quote: "400 viandas por día", evidence_type: "capacidad", origin: "declarado_por_persona", stated_by: null, declared_by: null, about: "company" }],
      finding_candidates: [],
      unknowns: [],
      next_actions: [],
    };
    const client = { beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: extraction, usage: { input_tokens: 1, output_tokens: 1 } }) } } } as unknown as Anthropic;
    const { data: id } = await db.rpc("create_capture", { p: { workspace_id: ws, client_id: randomUUID(), body: "Pasé por Viandas del Sur: entregan 400 viandas por día.", captured_at: new Date().toISOString(), ai_consent: true, media: [] } });
    await processCapture(db, { workspaceId: ws, settings, userId, captureId: id as string, client, transcriber: null });
    const { data: ps } = await db.from("proposals").select("id, kind, matches").eq("capture_id", id as string).order("position");
    const match = (ps![0].matches as { id: string }[])[0];
    expect(match.id).toBe(companyId);
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps![0].id, decision: { action: "aceptar", edits: { link_to: companyId } } })).toMatchObject({ ok: true });
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps![1].id, decision: { action: "aceptar" } })).toMatchObject({ ok: true });
    expect((await db.from("companies").select("id", { count: "exact", head: true })).count).toBe(1);
    const { data: ev } = await db.from("evidence").select("company_id, capture_id").eq("capture_id", id as string).single();
    expect(ev).toEqual({ company_id: companyId, capture_id: id });
  });
});
