// El Morning Brief elegido, en seco: corre la misión con lente de oportunidad y escribe el mail de prueba.
// No guarda nada en el Brain ni envía. BRIEF=1 OUT=brief.json HTML=brief.html npx vitest run tests/live/brief-mision.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { renderMissionBriefEmail } from "@/domain/brief/mission-brief";
import { runMissionBrief } from "@/server/brief/mission-brief";

describe.skipIf(!process.env.BRIEF || !process.env.OUT || !process.env.HTML)("brief de la misión", () => {
  it("corre", { timeout: 1_800_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: m } = await db.from("campaigns").select("id, workspace_id, name, workspaces(slug)").eq("kind", "mision").ilike("name", process.env.MISSION ?? "Vaca Muerta%").single();
    try {
      const r = await runMissionBrief(db, { workspaceId: m!.workspace_id, missionId: m!.id });
      const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://relevo.site").replace(/\/$/, "");
      const mail = renderMissionBriefEmail(r.brief, { mission: m!.name.split("—")[0].trim(), briefDate: new Date().toISOString().slice(0, 10), url: `${site}/hoy/${m!.workspaces?.slug}`, test: true });
      writeFileSync(process.env.HTML!, mail.html);
      writeFileSync(process.env.OUT!, JSON.stringify({ ...r, subject: mail.subject, text: mail.text }, null, 1));
    } catch (e) {
      writeFileSync(process.env.OUT!, JSON.stringify({ error: (e as Error).message }));
    }
  });
});
