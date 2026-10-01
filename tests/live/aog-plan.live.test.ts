// Prepara el plan de AOG de la misión activa (como el cron de las 06:00). AOG=1 OUT=aog.json npx vitest run tests/live/aog-plan.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { planAog } from "@/server/mission/aog";

describe.skipIf(!process.env.AOG || !process.env.OUT)("plan AOG", () => {
  it("prepara", { timeout: 600_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, workspace_id").eq("kind", "mision").eq("status", "activa").single();
    const t = Date.now();
    const r = await planAog(db, { workspaceId: m!.workspace_id, campaignId: m!.id });
    writeFileSync(process.env.OUT!, JSON.stringify({ seconds: (Date.now() - t) / 1000, ...r }, null, 2));
    expect(r.ok).toBe(true);
  });
});
