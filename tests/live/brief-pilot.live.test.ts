// Pilotos del Morning Brief, en seco (no guarda en el Brain ni envía): control · mision · oportunidad · ruido.
// PILOT=control OUT=piloto.json npx vitest run tests/live/brief-pilot.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { runPilot, type PilotKind } from "@/server/brief/pilot";

describe.skipIf(!process.env.PILOT || !process.env.OUT)("piloto del brief", () => {
  it("corre", { timeout: 1_800_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, workspace_id").eq("kind", "mision").ilike("name", "Vaca Muerta%").single();
    try {
      const r = await runPilot(db, { workspaceId: m!.workspace_id, missionId: m!.id, kind: process.env.PILOT as PilotKind });
      writeFileSync(process.env.OUT!, JSON.stringify(r, null, 1));
    } catch (e) {
      writeFileSync(process.env.OUT!, JSON.stringify({ error: (e as Error).message }));
    }
  });
});
