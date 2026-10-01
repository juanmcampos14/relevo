// Corre el análisis completo (estado + discovery) de UNA hipótesis por su código del CRM y deja el
// resultado, la evidencia usada y el costo en un JSON para revisarlo antes de procesar el resto.
// ASSESS=1 CODE=H-VA-09 USER_ID=<uuid> OUT=resultado.json npx vitest run tests/live/assess-one.live.test.ts
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { assessFinding } from "@/server/findings/assess";

describe.skipIf(!process.env.ASSESS || !process.env.CODE || !process.env.USER_ID || !process.env.OUT)("análisis de una hipótesis", () => {
  it("corre y guarda", { timeout: 600_000 }, async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { data: f } = await db.from("findings").select("id, workspace_id, statement, workspaces(settings)").eq("dedup_key", `crm:${process.env.CODE}`).single();
    const started = Date.now();
    const res = await assessFinding(db, { workspaceId: f!.workspace_id, settings: (f!.workspaces as { settings: unknown }).settings, userId: process.env.USER_ID!, findingId: f!.id });
    const seconds = (Date.now() - started) / 1000;
    expect(res.ok).toBe(true);
    const { data: a } = await db.from("finding_assessments").select("summary, dimensions, gaps, economics, discovery, supports, contradicts, independent_cases, ai_runs(model, prompt_version, input_tokens, output_tokens, cost_usd, duration_ms)").eq("finding_id", f!.id).order("created_at", { ascending: false }).limit(1).single();
    const { data: props } = await db.from("proposals").select("payload").eq("finding_id", f!.id).eq("status", "propuesta").order("position");
    const d = (a!.discovery ?? {}) as { evidence_refs?: string[]; signal_refs?: string[]; question_refs?: string[] };
    const ids = (refs: string[] | undefined) => (refs ?? []).map((r) => r.split(":")[1]);
    const [{ data: ev }, { data: sig }, { data: qs }] = await Promise.all([
      db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, companies(trade_name)").in("id", ids(d.evidence_refs)),
      db.from("brief_signals").select("id, headline, basis, happened_on, publisher").in("id", ids(d.signal_refs)),
      db.from("research_questions").select("id, code, question").in("id", ids(d.question_refs)),
    ]);
    writeFileSync(process.env.OUT!, JSON.stringify({ finding: f!.statement, seconds, assessment: a, validations: (props ?? []).map((p) => p.payload), evidence_used: ev, signals_used: sig, questions_used: qs }, null, 2));
  });
});
