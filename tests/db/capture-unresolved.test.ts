// Entidades sin identificar, resolución posterior sin perder historia, "Aprobar propuesta" y refinamiento de hipótesis.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { Extraction } from "@/server/capture/extract";
import { processCapture } from "@/server/capture/process";
import { approveCapture, decideProposal } from "@/server/capture/promote";
import { metrics, type EvidenceLink } from "@/domain/readiness";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-unres-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
const settings = { ai_processing_consent: true };
let ws: string, userId: string, db: SupabaseClient<Database>;
let next: Extraction;
const fakeClient = { beta: { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: next, usage: { input_tokens: 1, output_tokens: 1 } }) } } } as unknown as Anthropic;

const base: Omit<Extraction, "summary"> = { company: null, asset: null, people: [], evidence: [], finding_candidates: [], unknowns: [], next_actions: [] };
async function capture(body: string, extraction: Extraction) {
  const { data } = await db.rpc("create_capture", { p: { workspace_id: ws, client_id: randomUUID(), body, captured_at: new Date().toISOString(), ai_consent: true, media: [] } });
  next = extraction;
  const res = await processCapture(db, { workspaceId: ws, settings, userId, captureId: data as string, client: fakeClient, transcriber: null });
  expect(res).toMatchObject({ ok: true });
  return data as string;
}
const props = async (captureId: string) => ((await db.from("proposals").select("id, kind, status, result_id, result_type, payload").eq("capture_id", captureId).order("position")).data ?? []);

beforeAll(async () => {
  ws = await createWorkspace(pool, "Unresolved");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

let orgId: string, actorId: string, findingId: string;
const NOTE1 = "Hablé con el encargado de una contratista. Son 35 personas en la zona y cuando no hay vianda reintegran hasta 18.000 por comida.";

describe("día 1: una contratista y un encargado sin nombre", () => {
  it("Aprobar propuesta guarda todo sin inventar empresas ni personas", async () => {
    const id = await capture(NOTE1, {
      ...base,
      summary: "Encargado de una contratista sin identificar: 35 personas, reintegro de hasta $18.000 por comida.",
      company: { name: "Contratista con ~35 personas en la zona", identified: false, existing_id: null, resolves: null, locality: "Añelo", activity: "Contratista" },
      people: [{ key: "p1", name: null, role: "Encargado de la contratista", institutional: true, existing_id: null, resolves: null, owns_asset: false }],
      evidence: [
        { key: "e1", statement: "Trabajan unas 35 personas en la zona", quote: "Son 35 personas en la zona", evidence_type: "capacidad", origin: "declarado_por_persona", stated_by: "p1", declared_by: null, about: "company" },
        { key: "e2", statement: "Sin vianda contratada reintegran hasta $18.000 por comida", quote: "reintegran hasta 18.000 por comida", evidence_type: "precio", origin: "declarado_por_persona", stated_by: "p1", declared_by: null, about: "company" },
      ],
      finding_candidates: [{ statement: "Puede existir demanda B2B de comida cercana para contratistas sin vianda", existing_finding_id: null, relation: "nueva", refined_statement: null, is_idea: false, kind: "necesidad", rationale: "Un caso con techo de gasto.", supports: ["e1", "e2"], contradicts: [] }],
      unknowns: ["Nombre de la empresa", "Frecuencia mensual", "Quién decide"],
      next_actions: [
        { title: "Identificar empresa y decisor", why: "Sin eso no se dimensiona", contact: null, due: null },
        { title: "Preguntarle al encargado la frecuencia", why: "Dimensionar", contact: "p1", due: null },
      ],
    });
    const res = await approveCapture(db, { workspaceId: ws, settings, userId, captureId: id });
    expect(res).toMatchObject({ accepted: 7, pending: [], failed: [] });
    const { data: task } = await db.from("tasks").select("contact_id, description").eq("title", "Preguntarle al encargado la frecuencia").single();
    expect(task).toMatchObject({ contact_id: null, description: expect.stringContaining("Encargado de la contratista (sin identificar)") });

    expect((await db.from("companies").select("id", { count: "exact", head: true })).count).toBe(0);
    expect((await db.from("contacts").select("id", { count: "exact", head: true })).count).toBe(0);
    const { data: u } = await db.from("unresolved_entities").select("id, kind, label, parent_id").order("kind");
    expect(u!.map((x) => [x.kind, x.label])).toEqual([["actor", "Encargado de la contratista"], ["organization", "Contratista con ~35 personas en la zona"]]);
    [actorId, orgId] = [u![0].id, u![1].id];
    expect(u![0].parent_id).toBe(orgId);

    const { data: ev } = await db.from("evidence").select("id, company_id, about_unresolved_id, stated_by_contact_id, stated_by_unresolved_id, capture_id");
    expect(ev!.every((e) => e.about_unresolved_id === orgId && e.stated_by_unresolved_id === actorId && !e.company_id && !e.stated_by_contact_id)).toBe(true);

    const ps = await props(id);
    findingId = ps.find((p) => p.kind === "finding")!.result_id!;
    const { data: f } = await db.from("findings").select("maturity, company_id, finding_evidence(stance, evidence(id, verification_status, revalidate_after, company_id, stated_by_contact_id, capture_id, visit_id, source_id, about_unresolved_id, stated_by_unresolved_id))").eq("id", findingId).single();
    expect(f).toMatchObject({ maturity: "hipotesis", company_id: null });
    // Dos datos del mismo actor sin identificar: un solo caso.
    const links = f!.finding_evidence.map((x) => ({ ...x.evidence!, stance: x.stance })) as EvidenceLink[];
    expect(metrics(links, "2026-10-17").independentCases).toBe(1);
    expect((await db.from("captures").select("ai_unknowns").eq("id", id).single()).data!.ai_unknowns).toEqual(["Nombre de la empresa", "Frecuencia mensual", "Quién decide"]);
  });
});

describe("día 3: era PECOM y el encargado es Juan Pérez", () => {
  it("la resolución es una excepción: se confirma y la historia pasa a las entidades reales", async () => {
    const id = await capture("Confirmé que la contratista era PECOM; el encargado se llama Juan Pérez.", {
      ...base,
      summary: "La contratista era PECOM y el encargado es Juan Pérez.",
      company: { name: "PECOM", identified: true, existing_id: null, resolves: orgId, locality: "Añelo", activity: null },
      people: [{ key: "p1", name: "Juan Pérez", role: "Encargado", institutional: false, existing_id: null, resolves: actorId, owns_asset: false }],
    });
    const first = await approveCapture(db, { workspaceId: ws, settings, userId, captureId: id });
    expect(first.accepted).toBe(0);
    expect(first.pending.length).toBe(2);

    const ps = await props(id);
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps[0].id, decision: { action: "aceptar" } })).toMatchObject({ ok: true, message: /organización sin identificar/ });
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps[1].id, decision: { action: "aceptar" } })).toMatchObject({ ok: true, message: /persona sin identificar/ });
    const companyId = (await props(id))[0].result_id!;
    const contactId = (await props(id))[1].result_id!;

    const { data: ev } = await db.from("evidence").select("company_id, stated_by_contact_id, about_unresolved_id, stated_by_unresolved_id");
    // Pasa a PECOM y a Juan Pérez, conservando a quién apuntaba antes.
    expect(ev!.every((e) => e.company_id === companyId && e.stated_by_contact_id === contactId && e.about_unresolved_id === orgId && e.stated_by_unresolved_id === actorId)).toBe(true);
    const { data: u } = await db.from("unresolved_entities").select("id, resolved_company_id, resolved_contact_id, resolved_at");
    expect(u!.find((x) => x.id === orgId)).toMatchObject({ resolved_company_id: companyId });
    expect(u!.find((x) => x.id === actorId)).toMatchObject({ resolved_contact_id: contactId });
    const { data: link } = await db.from("contact_links").select("company_id").eq("contact_id", contactId);
    expect(link).toEqual([{ company_id: companyId }]);
  });
});

describe("refinar una hipótesis en vez de acumular contrapuestas", () => {
  it("segmenta: el enunciado cambia con la evidencia en contra y queda registrada la revisión", async () => {
    const id = await capture("Otro trabajador dice que no tiene ese problema porque su empresa le da vianda.", {
      ...base,
      summary: "Un trabajador con vianda de su empresa no tiene el problema.",
      people: [{ key: "p1", name: null, role: "Trabajador de una petrolera", institutional: false, existing_id: null, resolves: null, owns_asset: false }],
      evidence: [{ key: "e1", statement: "Su empresa le da vianda y no tiene problema para comer", quote: "su empresa le da vianda", evidence_type: "declaracion", origin: "declarado_por_persona", stated_by: "p1", declared_by: null, about: "none" }],
      finding_candidates: [{
        statement: "La necesidad depende del esquema de alimentación", existing_finding_id: findingId, relation: "segmenta",
        refined_statement: "La necesidad de comida cercana parece depender del esquema de alimentación de cada empresa", is_idea: false,
        kind: "necesidad", rationale: "Con vianda no hay problema; sin vianda, sí.", supports: [], contradicts: ["e1"],
      }],
    });
    const res = await approveCapture(db, { workspaceId: ws, settings, userId, captureId: id });
    expect(res.accepted).toBe(2); // persona (sin identificar) + evidencia; la reformulación espera confirmación
    const ps = await props(id);
    const f = ps.find((p) => p.kind === "finding")!;
    expect(f.status).toBe("propuesta");
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: f.id, decision: { action: "aceptar" } })).toMatchObject({ ok: true, message: /reformuló/ });

    const { data: finding } = await db.from("findings").select("statement, finding_evidence(stance)").eq("id", findingId).single();
    expect(finding!.statement).toBe("La necesidad de comida cercana parece depender del esquema de alimentación de cada empresa");
    expect(finding!.finding_evidence.map((x) => x.stance).sort()).toEqual(["contradicts", "supports", "supports"]);
    const { data: rev } = await db.from("finding_revisions").select("kind, relation, previous_value, new_value, capture_id").eq("finding_id", findingId);
    expect(rev).toEqual([{ kind: "enunciado", relation: "segmenta", previous_value: "Puede existir demanda B2B de comida cercana para contratistas sin vianda", new_value: finding!.statement, capture_id: id }]);
    expect((await db.from("findings").select("id", { count: "exact", head: true })).count).toBe(1);
  });
});
