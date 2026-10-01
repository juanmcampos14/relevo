// Migra RADAR DE MERCADO desde un export del CRM. En seco salvo APPLY=1. Reejecutable.
// XLSX=crm.xlsx OUT=informe.json [APPLY=1] WS=daicou npx vitest run tests/live/radar-migrate.live.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { migrateRadar } from "@/server/radar/import";

describe.skipIf(!process.env.XLSX || !process.env.OUT)("migración del RADAR", () => {
  it("informe (y aplicación si APPLY=1)", { timeout: 180_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const buf = readFileSync(process.env.XLSX!);
    const { data: ws } = await db.from("workspaces").select("id").eq("slug", process.env.WS ?? "daicou").single();
    const report = await migrateRadar(db, ws!.id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, { dryRun: process.env.APPLY !== "1" });
    writeFileSync(process.env.OUT!, JSON.stringify(report, null, 1));
  });
});
