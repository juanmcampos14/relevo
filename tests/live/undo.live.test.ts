// Deshace acciones aplicadas por RELEVO (igual que el botón Deshacer). UNDO=1 IDS=<id,id> npx vitest run tests/live/undo.live.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { undoContactEvent, type EventEffects } from "@/server/ai/contact-events";

describe.skipIf(!process.env.UNDO || !process.env.IDS)("deshacer", () => {
  it("deshace", async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    for (const id of process.env.IDS!.split(",").reverse()) {
      const { data: d } = await db.from("ai_action_drafts").select("after_state, status").eq("id", id).single();
      expect(d!.status).toBe("ejecutada");
      await undoContactEvent(db, d!.after_state as unknown as EventEffects);
      await db.from("ai_action_drafts").update({ status: "deshecha", decided_at: new Date().toISOString() }).eq("id", id);
    }
  });
});
