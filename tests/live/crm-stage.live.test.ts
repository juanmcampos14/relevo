// Deja un lote del CRM EN REVISIÓN (no aprueba ni escribe entidades): lo aprueba una persona en Integraciones.
// STAGE=1 XLSX=crm.xlsx WS=daicou npx vitest run tests/live/crm-stage.live.test.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { parseCrmWorkbook } from "@/server/crm-import/parse";
import { stageImport } from "@/server/crm-import/stage";

describe.skipIf(!process.env.STAGE || !process.env.XLSX)("lote del CRM en revisión", () => {
  it("staging sin aprobar", { timeout: 180_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const buf = readFileSync(process.env.XLSX!);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const { data: ws } = await db.from("workspaces").select("id").eq("slug", process.env.WS ?? "daicou").single();
    const id = await stageImport(db, ws!.id, await parseCrmWorkbook(ab), { fileName: basename(process.env.XLSX!), sha256: createHash("sha256").update(buf).digest("hex") });
    const { data } = await db.from("import_batches").select("status, summary").eq("id", id).single();
    expect(data!.status).toBe("en_revision");
    console.log("lote", id, JSON.stringify(data!.summary));
  });
});
