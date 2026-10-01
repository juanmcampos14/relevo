// Congela la línea de base de la misión activa (último análisis de cada hipótesis).
// BASELINE=1 npx vitest run tests/live/baseline.live.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { freezeBaseline } from "@/server/findings/baseline";

describe.skipIf(!process.env.BASELINE)("línea de base", () => {
  it("congela", async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, name").eq("kind", "mision").eq("status", "activa").single();
    const r = await freezeBaseline(db, m!.id);
    console.info(m!.name, JSON.stringify(r));
    expect(r.withoutAnalysis).toEqual([]);
  });
});
