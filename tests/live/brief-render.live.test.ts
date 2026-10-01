// Renderiza el email de un brief guardado (el mismo render que usa el envío). Solo lectura.
// BRIEF_ID=… OUT=brief.html npx vitest run tests/live/brief-render.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { BriefContent } from "@/domain/brief/contract";
import { renderBriefEmail } from "@/domain/brief/render";

describe.skipIf(!process.env.BRIEF_ID || !process.env.OUT)("render del brief", () => {
  it("email", async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: b } = await db.from("briefs").select("id, brief_date, content, workspaces(name, slug)").eq("id", process.env.BRIEF_ID!).single();
    const ws = b!.workspaces as unknown as { name: string; slug: string };
    const e = renderBriefEmail(b!.content as unknown as BriefContent, { briefId: b!.id, briefDate: b!.brief_date, workspaceName: ws.name, url: `https://www.relevo.site/w/${ws.slug}/brief/${b!.id}` });
    writeFileSync(process.env.OUT!, e.html);
    writeFileSync(`${process.env.OUT!}.subject.txt`, e.subject);
  });
});
