// Aprueba y escribe un lote del CRM ya revisado (mismas funciones que la pantalla de Integraciones):
// aplica las propuestas indicadas, aprueba lo importable, escribe y descarta lotes viejos.
// APPROVE=1 BATCH=<id> USER=<uuid> RESOLVE='{"AN-0096":{"1":"aplicar"}}' DISCARD=<id,id> npx vitest run tests/live/crm-approve.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { decideRow } from "@/server/crm-import/review";
import { applyBatch, type Resolution } from "@/server/crm-import/apply";
import { triageBatch, type TriageRow } from "@/domain/crm-import/triage";

describe.skipIf(!process.env.APPROVE || !process.env.BATCH || !process.env.USER_ID)("aprobar y escribir lote", () => {
  it("decide, aprueba, aplica", { timeout: 600_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const batch = process.env.BATCH!;
    const user = process.env.USER_ID!;
    const resolve = JSON.parse(process.env.RESOLVE ?? "{}") as Record<string, Resolution["issues"]>;
    const { data: b } = await db.from("import_batches").select("workspace_id, status").eq("id", batch).single();
    expect(b!.status).toBe("en_revision");
    const { data } = await db.from("import_rows").select("id, entity_type, external_id, action, decision, raw, mapped, issues, conflicts").eq("batch_id", batch);
    const rows = (data ?? []) as unknown as TriageRow[];
    const log: string[] = [];
    for (const [ext, issues] of Object.entries(resolve)) {
      const r = rows.find((x) => x.external_id === ext);
      const res = await decideRow(db, r!.id, "aprobada", { issues }, user);
      log.push(`${ext}: ${res.error ?? "aprobada con propuesta"}`);
      expect(res.error).toBeUndefined();
    }
    const triage = triageBatch(rows);
    let n = 0;
    for (const r of rows) {
      if (r.decision !== "pendiente" || triage.get(r.id)?.lane !== "importable") continue;
      const res = await decideRow(db, r.id, "aprobada", {}, user);
      if (!res.error) n++;
    }
    log.push(`importables aprobadas: ${n}`);
    const applied = await applyBatch(db, b!.workspace_id, batch);
    log.push(`aplicadas: ${applied.applied}, sin cambios: ${applied.unchanged}, errores: ${JSON.stringify(applied.errors)}`);
    for (const old of (process.env.DISCARD ?? "").split(",").filter(Boolean)) {
      await db.from("import_batches").update({ status: "descartado", closed_at: new Date().toISOString() }).eq("id", old).eq("status", "en_revision");
      log.push(`descartado ${old}`);
    }
    writeFileSync(process.env.OUT ?? "/dev/null", log.join("\n"));
    expect(applied.errors).toEqual([]);
  });
});
