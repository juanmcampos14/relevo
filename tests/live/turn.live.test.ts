// Un turno real de conversación con RELEVO (mismo runTurn que la página y el panel), para mirar producto:
// qué responde, qué decide mostrar, qué herramientas usó, cuánto tarda y cuánto cuesta.
// TURN=1 USER_ID=<uuid> TEXT="RELEVO, me voy a Añelo. Preparame." OUT=turno.json npx vitest run tests/live/turn.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { runTurn } from "@/server/ai/turn";

describe.skipIf(!process.env.TURN || !process.env.USER_ID || !process.env.TEXT || !process.env.OUT)("turno real", () => {
  it("conversa", { timeout: 600_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: w } = await db.from("workspaces").select("id, slug, name, settings").eq("slug", process.env.WS ?? "daicou").single();
    // HERE="lat,lng" y PLACE="Palermo, Buenos Aires" simulan la calle.
    const [lat, lng] = (process.env.HERE ?? "").split(",").map(Number);
    const here = Number.isFinite(lat) && Number.isFinite(lng) && process.env.HERE ? { lat, lng, accuracy: 20 } : null;
    const started = Date.now();
    const res = await runTurn(db, { slug: w!.slug, workspaceId: w!.id, workspaceName: w!.name, userId: process.env.USER_ID!, settings: w!.settings, conversationId: process.env.CONVERSATION ?? null, text: process.env.TEXT!, scope: "", here, place: process.env.PLACE ?? null });
    const seconds = (Date.now() - started) / 1000;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { data: msgs } = await db.from("ai_messages").select("role, api_content").eq("conversation_id", res.conversationId).order("created_at");
    const tools = JSON.stringify(msgs).match(/"type":"(?:server_)?tool_use"[^}]*?"name":"([a-z_]+)"/g)?.map((m) => m.match(/"name":"([a-z_]+)"/)![1]) ?? [];
    const { data: run } = await db.from("ai_runs").select("model, cost_usd, duration_ms, input_tokens, output_tokens").eq("user_id", process.env.USER_ID!).order("created_at", { ascending: false }).limit(1).single();
    writeFileSync(process.env.OUT!, JSON.stringify({ seconds, conversationId: res.conversationId, tools, run, drafts: res.draftIds.length, text: res.text, citations: res.citations.length }, null, 2));
  });
});
