// Estado de la misión (lo que RELEVO ya sabe, en lenguaje humano), como lo prepara el cron de cada mañana.
// STATE=1 OUT=estado.json npx vitest run tests/live/mission-state.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { describeMission } from "@/server/mission/state";

describe.skipIf(!process.env.STATE || !process.env.OUT)("estado de la misión", () => {
  it("prepara", { timeout: 900_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, workspace_id").eq("kind", "mision").eq("status", "activa").single();
    const t0 = Date.now();
    const r = await describeMission(db, { workspaceId: m!.workspace_id, campaignId: m!.id });
    writeFileSync(process.env.OUT!, JSON.stringify({ seconds: (Date.now() - t0) / 1000, ...r }, null, 2));
    expect(r.ok).toBe(true);
  });
});
