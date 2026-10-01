// Corre el análisis completo (estado + discovery) de todas las hipótesis activas, de a varias en paralelo,
// y deja por hipótesis: resultado, costo, duración, versión y evidencia usada (auditoría y re-evaluación).
// ASSESS_ALL=1 USER_ID=<uuid> OUT=resultado.json [PARALLEL=4] npx vitest run tests/live/assess-all.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { assessFinding } from "@/server/findings/assess";

describe.skipIf(!process.env.ASSESS_ALL || !process.env.USER_ID || !process.env.OUT)("análisis de todas las hipótesis", () => {
  it("corre y guarda", { timeout: 1_800_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: fs } = await db.from("findings").select("id, workspace_id, dedup_key, statement, workspaces(settings)").neq("review_status", "rechazado").eq("case_status", "activo").order("dedup_key");
    const queue = [...(fs ?? [])];
    const out: Record<string, unknown>[] = [];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const started = Date.now();
        const res = await assessFinding(db, { workspaceId: f.workspace_id, settings: (f.workspaces as { settings: unknown }).settings, userId: process.env.USER_ID!, findingId: f.id });
        const { data: a } = await db.from("finding_assessments").select("created_at, summary, gaps, economics, discovery, ai_runs(model, prompt_version, cost_usd, duration_ms)").eq("finding_id", f.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        out.push({ code: f.dedup_key?.replace(/^crm:/, "") ?? "(campo)", statement: f.statement, ok: res.ok, message: res.ok ? null : res.message, seconds: (Date.now() - started) / 1000, assessment: a });
      }
    };
    const started = Date.now();
    await Promise.all(Array.from({ length: Number(process.env.PARALLEL ?? 4) }, worker));
    writeFileSync(process.env.OUT!, JSON.stringify({ total_seconds: (Date.now() - started) / 1000, results: out }, null, 2));
    expect(out.filter((r) => !r.ok)).toEqual([]);
  });
});
