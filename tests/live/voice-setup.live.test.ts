// Crea (idempotente) el experimento Voice of Añelo en BORRADOR en un workspace. No lo publica.
// SETUP_VOICE=1 WS=daicou npx vitest run tests/live/voice-setup.live.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { ensureVoiceExperiment } from "@/server/voice/experiment";

describe.skipIf(!process.env.SETUP_VOICE)("Voice of Añelo · alta en borrador", () => {
  it("crea experimento, variantes y cuestionario v1", async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: ws } = await db.from("workspaces").select("id").eq("slug", process.env.WS ?? "daicou").single();
    const { data: mission } = await db.from("campaigns").select("id").eq("workspace_id", ws!.id).eq("kind", "mision").eq("status", "activa").order("created_at").limit(1).maybeSingle();
    const id = await ensureVoiceExperiment(db, ws!.id, mission?.id ?? null);
    const { data: e } = await db.from("research_experiments").select("status, experiment_variants(code), survey_versions(version)").eq("id", id).single();
    expect(e!.status).toBe("borrador");
    console.log(JSON.stringify(e));
  });
});
