// Incremento D con RLS e IA simulada: evidencia → estado (qué sabemos / qué falta) → validación propuesta →
// humano la agenda (tarea) → segundo caso → el faltante desaparece.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { assessFinding } from "@/server/findings/assess";
import { decideProposal } from "@/server/capture/promote";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-d-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
const settings = { ai_processing_consent: true };
let ws: string, userId: string, db: SupabaseClient<Database>, finding: string, e1: string, e2: string, e3: string, c2: string;
const prompts: string[] = [];

const fakeClient = {
  beta: {
    messages: {
      parse: async (req: { messages: { content: string }[] }) => {
        prompts.push(req.messages[0].content);
        return {
          stop_reason: "end_turn",
          usage: { input_tokens: 900, output_tokens: 300 },
          parsed_output: {
            summary: "Una sola empresa lo declaró y hay un dato en contra.",
            dimensions: [
              { key: "problema", status: "sabido", summary: "Una empresa declaró que manda camionetas a Neuquén.", evidence_ids: [e1, "inventada"] },
              { key: "frecuencia", status: "sabido", summary: "Todas las semanas.", evidence_ids: [] },
              { key: "solucion_actual", status: "contradicho", summary: "Hay un taller que dice hacerlo.", evidence_ids: [e2] },
            ],
            next_validations: [
              { title: "Entrevistar una segunda empresa con flota", why: "Un solo caso.", gap: "falta_triangulacion", who: "Otra empresa con flota" },
              { title: "Visitar el taller que dice hacer ese mantenimiento", why: "Resolver la contradicción.", gap: "contradiccion_sin_resolver", who: "Taller" },
            ],
          },
        };
      },
    },
  },
} as unknown as Anthropic;

const assess = () => assessFinding(db, { workspaceId: ws, settings, userId, findingId: finding, client: fakeClient, today: "2026-10-17" });
const latest = async () => (await db.from("finding_assessments").select("gaps, dimensions, supports, contradicts, independent_cases").eq("finding_id", finding).order("created_at", { ascending: false }).limit(1).single()).data!;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Estado");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  const q = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].id as string;
  const src = await q(`insert into sources (workspace_id, kind, title) values ($1, 'observacion', 'Captura') returning id`, [ws]);
  const c1 = await q(`insert into companies (workspace_id, trade_name) values ($1, 'Flota Uno') returning id`, [ws]);
  c2 = await q(`insert into companies (workspace_id, trade_name) values ($1, 'Flota Dos') returning id`, [ws]);
  finding = await q(`insert into findings (workspace_id, source_id, kind, statement) values ($1, $2, 'necesidad', 'Posible falta de talleres de flota en Añelo') returning id`, [ws, src]);
  e1 = await q(`insert into evidence (workspace_id, statement, origin_kind, company_id) values ($1, 'Mandan 8 camionetas por semana a Neuquén', 'conversation', $2) returning id`, [ws, c1]);
  e2 = await q(`insert into evidence (workspace_id, statement, origin_kind, verification_status, source_id) values ($1, 'Un taller de Añelo dice que hace ese mantenimiento', 'field', 'field_verified', $2) returning id`, [ws, src]);
  e3 = await q(`insert into evidence (workspace_id, statement, origin_kind, company_id) values ($1, 'Otra flota también manda unidades a Neuquén', 'conversation', $2) returning id`, [ws, c2]);
  await pool.query(`insert into finding_evidence (workspace_id, finding_id, evidence_id, stance) values ($1, $2, $3, 'supports'), ($1, $2, $4, 'contradicts')`, [ws, finding, e1, e2]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});

afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("estado de un finding", () => {
  it("sin consentimiento no se llama a la IA", async () => {
    expect(await assessFinding(db, { workspaceId: ws, settings: {}, userId, findingId: finding, client: fakeClient })).toMatchObject({ ok: false });
    expect(prompts).toHaveLength(0);
  });

  it("qué sabemos / qué contradice / qué falta, controlado contra la evidencia real", async () => {
    expect(await assess()).toMatchObject({ ok: true, proposals: 2 });
    expect(prompts[0]).toContain("1 a favor · 1 en contra · 1 caso(s) independiente(s)");
    const a = await latest();
    expect(a).toMatchObject({ supports: 1, contradicts: 1, independent_cases: 1 });
    expect(a.gaps.slice(0, 2)).toEqual(["contradiccion_sin_resolver", "falta_triangulacion"]);
    const dims = a.dimensions as { key: string; status: string; evidence_ids: string[] }[];
    expect(dims).toHaveLength(12);
    expect(dims.find((d) => d.key === "problema")).toMatchObject({ status: "sabido", evidence_ids: [e1] });
    expect(dims.find((d) => d.key === "frecuencia")!.status).toBe("creido");
    expect(dims.find((d) => d.key === "solucion_actual")!.status).toBe("contradicho");
  });

  it("las validaciones se proponen en orden (la contradicción primero) y agendarlas crea la tarea del finding", async () => {
    const { data: ps } = await db.from("proposals").select("id, position, payload").eq("finding_id", finding).eq("status", "propuesta").order("position");
    expect(ps!.map((p) => (p.payload as { gap: string }).gap)).toEqual(["contradiccion_sin_resolver", "falta_triangulacion"]);
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps![0].id, decision: { action: "aceptar" } })).toMatchObject({ ok: true });
    const { data: task } = await db.from("tasks").select("title, finding_id, kind, assignee_id").eq("id", ps![0].id).single();
    expect(task).toEqual({ title: "Visitar el taller que dice hacer ese mantenimiento", finding_id: finding, kind: "Validación", assignee_id: userId });
  });

  it("un segundo caso de otra empresa elimina 'falta triangulación'; lo ya decidido se conserva", async () => {
    await db.from("finding_evidence").insert({ workspace_id: ws, finding_id: finding, evidence_id: e3, stance: "supports" });
    await assess();
    const a = await latest();
    expect(a.independent_cases).toBe(2);
    expect(a.gaps).not.toContain("falta_triangulacion");
    const { data: all } = await db.from("proposals").select("status").eq("finding_id", finding);
    expect(all!.filter((p) => p.status === "aceptada")).toHaveLength(1);
    expect(all!.filter((p) => p.status === "propuesta")).toHaveLength(2);
    // Nada se promovió a oportunidad.
    const { count } = await db.from("opportunities").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });
});
