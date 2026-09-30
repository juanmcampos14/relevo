// Corrida real del Morning Brief contra la base LOCAL (fuentes reales + Claude real, sin email).
// RUN_CONTRACT=1 npx vitest run tests/live/morning-brief.live.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { advanceBrief, ensureTodayBrief } from "@/server/brief/pipeline";
import { claudeResearchEngine, claudeSynthesisEngine } from "@/server/brief/engines";

describe.skipIf(!process.env.RUN_CONTRACT)("Morning Brief real (local)", () => {
  it("genera el brief de hoy", { timeout: 900_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/);
    const { data: w } = await db.from("workspaces").select("id").eq("slug", "daicou").single();
    const id = await ensureTodayBrief(db, w!.id);
    const engines = { research: claudeResearchEngine(), synthesis: claudeSynthesisEngine(), email: null };
    for (let i = 0; i < 4; i++) {
      const t = Date.now();
      const out = await advanceBrief(db, id, engines, { siteUrl: "http://localhost:3000" });
      console.log(JSON.stringify(out), `${Math.round((Date.now() - t) / 1000)}s`);
      if (!out.more || out.error) break;
    }
    const { data: b } = await db.from("briefs").select("status, error, usage, content, collected").eq("id", id).single();
    console.log("USAGE", JSON.stringify(b!.usage));
    console.log("COLLECTED", (b!.collected as unknown[]).length);
    console.log("CONTENT", JSON.stringify(b!.content, null, 1));
    expect(b!.status).toBe("generado");
  });
});
