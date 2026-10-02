// Mismo caso, mismo input, dos modelos: estado y síntesis de una misión en seco (no se guarda nada en la
// misión; cada corrida queda en ai_runs con su costo). AB=1 OUT=ab.json npx vitest run tests/live/models-ab.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { DeepModel } from "@/server/mission/deep";
import { describeMission } from "@/server/mission/state";
import { synthesizeMission } from "@/server/mission/synthesis";

const MODELS: DeepModel[] = ["claude-opus-5-5", "claude-sonnet-5-5"];

describe.skipIf(!process.env.AB || !process.env.OUT)("modelos A/B", () => {
  it("compara", { timeout: 1_800_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, workspace_id").eq("kind", "mision").ilike("name", process.env.MISSION ?? "Vaca Muerta%").single();
    const today = new Date();
    const out: Record<string, unknown> = {};
    for (const model of MODELS) {
      for (const [job, run] of [
        ["estado", () => describeMission(db, { workspaceId: m!.workspace_id, campaignId: m!.id, model, dryRun: true })],
        ["sintesis", () => synthesizeMission(db, { workspaceId: m!.workspace_id, campaignId: m!.id, model, dryRun: true, today })],
      ] as const) {
        const started = Date.now();
        const r = await run().catch((e: Error) => ({ ok: false as const, message: e.message }));
        out[`${job}:${model}`] = { seconds: (Date.now() - started) / 1000, ...r };
      }
    }
    writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
  });
});
