// Ubicación en lote (OpenStreetMap). En seco salvo APPLY=1. Nunca asigna "confirmada".
// GEOCODE=1 OUT=geo.json [APPLY=1] npx vitest run tests/live/geocode.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { geocodeAll } from "@/server/geo-bulk";

describe.skipIf(!process.env.GEOCODE || !process.env.OUT)("ubicación en lote", () => {
  it("ubica", { timeout: 900_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    writeFileSync(process.env.OUT!, JSON.stringify(await geocodeAll(db, { dryRun: process.env.APPLY !== "1" }), null, 2));
  });
});
