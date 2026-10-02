// Audio sobre el mismo pipeline de C: audio original → transcripción → propuestas → evidencia con el segundo exacto.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { Extraction } from "@/server/capture/extract";
import type { Transcriber } from "@/server/capture/transcribe";
import { processCapture } from "@/server/capture/process";
import { decideProposal } from "@/server/capture/promote";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const email = `tano-audio-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();
const settings = { ai_processing_consent: true };
let ws: string, userId: string, db: SupabaseClient<Database>;

let seenByModel = "";
const fakeClient = {
  beta: {
    messages: {
      parse: async (req: { messages: { content: { type: string; text?: string }[] }[] }) => {
        seenByModel = req.messages[0].content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const extraction: Extraction = {
          summary: "Pedro, de una empresa de flota, cuenta que pierden un día por reparación.",
          company: null,
          asset: null,
          people: [{ key: "p1", name: "Pedro", role: null, institutional: false, existing_id: null, resolves: null, owns_asset: false }],
          evidence: [{ key: "e1", statement: "Tienen cuarenta camionetas", quote: "tienen cuarenta camionetas", evidence_type: "capacidad", origin: "declarado_por_persona", declared_by: null, stated_by: "p1", about: "none" as const }],
          finding_candidates: [],
          unknowns: [],
          next_actions: [],
        };
        return { stop_reason: "end_turn", parsed_output: extraction, usage: { input_tokens: 500, output_tokens: 200 } };
      },
    },
  },
} as unknown as Anthropic;

let transcriptions = 0;
const fakeTranscriber: Transcriber = async (audio, mime) => {
  transcriptions++;
  expect(audio.byteLength).toBeGreaterThan(0);
  expect(mime).toBe("audio/mp4");
  return {
    ok: true,
    provider: "prueba",
    model: "prueba",
    language: "es-419",
    durationMs: 20_000,
    text: "Estuve con Pedro. Tienen cuarenta camionetas y cuando algo no se repara en Añelo pierden un día.",
    utterances: [
      { start_ms: 0, end_ms: 3000, text: "Estuve con Pedro." },
      { start_ms: 3000, end_ms: 9000, text: "Tienen cuarenta camionetas y cuando algo" },
      { start_ms: 9000, end_ms: 20000, text: "no se repara en Añelo pierden un día." },
    ],
  };
};

async function audioCapture(): Promise<string> {
  const clientId = randomUUID();
  const path = `${ws}/${clientId}/a1.m4a`;
  const { error } = await db.storage.from("captures").upload(path, new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { contentType: "audio/mp4" });
  if (error) throw error;
  const { data, error: e2 } = await db.rpc("create_capture", {
    p: { workspace_id: ws, client_id: clientId, body: "", captured_at: new Date().toISOString(), ai_consent: true, media: [{ kind: "audio", storage_path: path, mime_type: "audio/mp4", size_bytes: 8, duration_ms: 20000 }] },
  });
  if (e2) throw e2;
  return data as string;
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Audio");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});

afterAll(async () => {
  await pool.query(`delete from storage.objects where bucket_id = 'captures' and name like $1`, [`${ws}/%`]).catch(() => {});
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("audio → transcripción → propuestas", () => {
  it("sin transcripción configurada, un audio solo queda guardado con un aviso claro", async () => {
    const id = await audioCapture();
    const res = await processCapture(db, { workspaceId: ws, settings, userId, captureId: id, client: fakeClient, transcriber: null });
    expect(res).toMatchObject({ ok: false, message: /DEEPGRAM_API_KEY/ });
    const { data } = await db.from("captures").select("status").eq("id", id).single();
    expect(data!.status).toBe("guardado");
  });

  it("transcribe, conserva audio y transcripción, y la evidencia apunta al segundo exacto", async () => {
    const id = await audioCapture();
    const res = await processCapture(db, { workspaceId: ws, settings, userId, captureId: id, client: fakeClient, transcriber: fakeTranscriber });
    expect(res).toEqual({ ok: true, proposals: 2 });
    expect(seenByModel).toContain("[Audio 1, 0:20, transcripción automática]");

    const { data: t } = await db.from("transcripts").select("status, text, utterances, duration_ms").eq("capture_id", id).single();
    expect(t).toMatchObject({ status: "ok", duration_ms: 20000 });
    expect((t!.utterances as unknown[]).length).toBe(3);

    const { data: ps } = await db.from("proposals").select("id, kind, quote, payload").eq("capture_id", id).order("position");
    expect(ps![1]).toMatchObject({ kind: "evidence", quote: "tienen cuarenta camionetas" });
    expect((ps![1].payload as { audio: unknown }).audio).toMatchObject({ start_ms: 3000, end_ms: 9000 });

    await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps![0].id, decision: { action: "aceptar" } });
    expect(await decideProposal(db, { workspaceId: ws, settings, userId, proposalId: ps![1].id, decision: { action: "aceptar" } })).toMatchObject({ ok: true });
    const { data: ev } = await db.from("evidence").select("capture_id, capture_media_id, media_start_ms, media_end_ms, quote").eq("id", ps![1].id).single();
    expect(ev).toMatchObject({ capture_id: id, media_start_ms: 3000, media_end_ms: 9000, quote: "tienen cuarenta camionetas" });
    expect(ev!.capture_media_id).not.toBeNull();
  });

  it("el mismo audio subido otra vez es la misma conversación: no se procesa ni cuenta como fuente nueva", async () => {
    const before = transcriptions;
    const id = await audioCapture();
    const res = await processCapture(db, { workspaceId: ws, settings, userId, captureId: id, client: fakeClient, transcriber: fakeTranscriber });
    expect(res).toMatchObject({ ok: false, duplicateOf: expect.any(String) });
    expect(transcriptions - before).toBe(0); // ni se transcribe
    const { data: cap } = await db.from("captures").select("status, duplicate_of").eq("id", id).single();
    expect(cap).toMatchObject({ status: "duplicado", duplicate_of: (res as { duplicateOf: string }).duplicateOf });
    expect((await db.from("proposals").select("id", { count: "exact", head: true }).eq("capture_id", id)).count).toBe(0);
  });

  it("reprocesar tras un error no vuelve a transcribir lo ya transcripto (confirmado como otra conversación)", async () => {
    const before = transcriptions;
    const id = await audioCapture();
    await processCapture(db, { workspaceId: ws, settings, userId, captureId: id, client: fakeClient, transcriber: fakeTranscriber, force: true });
    await pool.query(`update captures set status = 'error', status_error = 'forzado' where id = $1`, [id]);
    await pool.query(`delete from proposals where capture_id = $1`, [id]);
    await processCapture(db, { workspaceId: ws, settings, userId, captureId: id, client: fakeClient, transcriber: fakeTranscriber, force: true });
    expect(transcriptions - before).toBe(1);
  });
});
