// "RELEVO ya trabajó": corre el trabajo profundo de la misión activa (por qué importa cada objetivo y la
// síntesis del día) como lo hace el cron de las 06:00, y deja resultado y costo en un JSON.
// PREPARE=1 OUT=mision.json [SKIP_TARGETS=1] npx vitest run tests/live/mission-prepare.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { briefTargets } from "@/server/mission/targets";
import { synthesizeMission } from "@/server/mission/synthesis";

describe.skipIf(!process.env.PREPARE || !process.env.OUT)("preparar misión", () => {
  it("prepara", { timeout: 1_800_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, workspace_id").eq("kind", "mision").eq("status", "activa").single();
    const t0 = Date.now();
    const targets = process.env.SKIP_TARGETS ? null : await briefTargets(db, { workspaceId: m!.workspace_id, campaignId: m!.id });
    const t1 = Date.now();
    const synthesis = await synthesizeMission(db, { workspaceId: m!.workspace_id, campaignId: m!.id });
    writeFileSync(process.env.OUT!, JSON.stringify({ targets, targets_seconds: (t1 - t0) / 1000, synthesis, synthesis_seconds: (Date.now() - t1) / 1000 }, null, 2));
    expect(synthesis.ok).toBe(true);
  });
});
