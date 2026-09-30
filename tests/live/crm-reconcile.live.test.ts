// Conciliación en seco del CRM: simula la reimportación de un export del Sheet contra una base (solo lectura)
// y deja el plan por fila con su carril (importable / revisar / bloqueado) para revisarlo antes de subirlo.
// XLSX=ruta.xlsx OUT=plan.json WS=daicou npx vitest run tests/live/crm-reconcile.live.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { parseCrmWorkbook } from "@/server/crm-import/parse";
import { planImport } from "@/server/crm-import/stage";
import { triageBatch, type TriageRow } from "@/domain/crm-import/triage";

describe.skipIf(!process.env.XLSX || !process.env.OUT)("conciliación del CRM (en seco)", () => {
  it("plan de reimportación sin escribir", { timeout: 180_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const buf = readFileSync(process.env.XLSX!);
    const parsed = await parseCrmWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const { data: ws } = await db.from("workspaces").select("id").eq("slug", process.env.WS ?? "daicou").single();
    const { rows, summary } = await planImport(db, ws!.id, parsed);
    const withIds = rows.map((r, i) => ({ ...r, id: String(i) })) as unknown as TriageRow[];
    const t = triageBatch(withIds);
    const out = withIds.map((r) => ({ ...r, lane: t.get(r.id)?.lane ?? "sin_cambios", reasons: t.get(r.id)?.reasons ?? [] }));
    writeFileSync(process.env.OUT!, JSON.stringify({ summary, formulaIds: parsed.formulaIds, rows: out }, null, 1));
  });
});
