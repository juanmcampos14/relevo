// Documentos de contexto: RELEVO los lista y los lee (con su jerarquía explícita); no son evidencia.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { runKnowledgeTool } from "@/server/ai/tools-knowledge";
import type { ToolContext } from "@/server/ai/tools";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-docs-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
let ws: string, userId: string, db: SupabaseClient<Database>, docId: string;

beforeAll(async () => {
  ws = await createWorkspace(pool, "Docs");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [ws, userId]);
  docId = (await pool.query(
    `insert into context_documents (workspace_id, title, kind, summary, body) values ($1, '16 verticales', 'metodologia', 'Ficha común', $2) returning id`,
    [ws, "UNA MISMA FICHA PARA TODAS.\n\n02 FERRETERÍAS + SUMINISTROS INDUSTRIALES: medir stock crítico, hidráulica y EPP.\n\n09 ALOJAMIENTO: separar tarifa publicada de negociada."],
  )).rows[0].id;
  await pool.query(`insert into context_documents (workspace_id, title, body, status) values ($1, 'Viejo', 'x', 'archivado')`, [ws]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});
afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

const ctx = (): ToolContext => ({ db, slug: "docs", seenRefs: new Set(), saveDraft: async () => "" });

describe("context_documents", () => {
  it("lista solo los vigentes, con referencia citable y aviso de que no son evidencia", async () => {
    const c = ctx();
    const res = JSON.parse((await runKnowledgeTool("context_documents", {}, c)).content);
    expect(res.documents.map((d: { title: string }) => d.title)).toEqual(["16 verticales"]);
    expect(res.note).toMatch(/no son evidencia/);
    expect(c.seenRefs.has(`document:${docId}`)).toBe(true);
  });

  it("con query devuelve los párrafos pertinentes y la jerarquía", async () => {
    const res = JSON.parse((await runKnowledgeTool("context_documents", { document_ref: `document:${docId}`, query: "hidráulica" }, ctx())).content);
    expect(res.body).toContain("FERRETERÍAS");
    expect(res.body).not.toContain("ALOJAMIENTO");
    expect(res.hierarchy).toMatch(/^evidencia actual/);
  });
});
