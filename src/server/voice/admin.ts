import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { funnel, parseMetaCsv, suppress, type FunnelStage } from "@/domain/voice/metrics";
import { segmentsOf, type Answers, type SurveyDefinition } from "@/domain/voice/survey";

// Tablero interno del experimento (cliente del usuario: RLS decide qué ve cada rol).

type Db = SupabaseClient<Database>;
type J = NonNullable<Json>;
export type Cohort = "real" | "piloto" | "prueba";

export async function importMetaCsv(db: Db, workspaceId: string, experimentId: string, fileName: string, text: string) {
  const parsed = parseMetaCsv(text);
  const { data: variants } = await db.from("experiment_variants").select("code, meta_ad_id").eq("experiment_id", experimentId);
  const byAd = new Map((variants ?? []).filter((v) => v.meta_ad_id).map((v) => [v.meta_ad_id!, v.code]));
  const unmatched = [...new Set(parsed.rows.filter((r) => !byAd.has(r.ad_id)).map((r) => `${r.ad_id}${r.ad_name ? ` (${r.ad_name})` : ""}`))];
  const { data: imp, error } = await db
    .from("ad_metric_imports")
    .insert({
      workspace_id: workspaceId, experiment_id: experimentId, file_name: fileName, file_sha256: createHash("sha256").update(text).digest("hex"), file_text: text,
      period_start: parsed.periodStart, period_end: parsed.periodEnd, currency: parsed.currency, rows_total: parsed.rows.length + parsed.rejected.length,
      rows_applied: parsed.rows.length, rejected: parsed.rejected as unknown as J, unmatched: unmatched as unknown as J,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  if (parsed.rows.length) {
    // (día, anuncio) es único: reimportar el mismo período actualiza los números, no suma gasto.
    const { error: e2 } = await db.from("ad_metrics_daily").upsert(
      parsed.rows.map((r) => ({
        workspace_id: workspaceId, experiment_id: experimentId, day: r.day, meta_campaign_id: r.campaign_id, meta_adset_id: r.adset_id, meta_ad_id: r.ad_id, ad_name: r.ad_name,
        variant_code: byAd.get(r.ad_id) ?? null, currency: r.currency, spend: r.spend, impressions: r.impressions, reach: r.reach, link_clicks: r.link_clicks,
        landing_page_views: r.landing_page_views, import_id: imp.id, updated_at: new Date().toISOString(),
      })),
      { onConflict: "experiment_id,day,meta_ad_id" },
    );
    if (e2) return { error: e2.message };
  }
  return { importId: imp.id, applied: parsed.rows.length, rejected: parsed.rejected, unmatched, currency: parsed.currency, period: [parsed.periodStart, parsed.periodEnd] };
}

export type Dashboard = {
  funnelAll: FunnelStage[];
  funnelByVariant: { variant: string; stages: FunnelStage[] }[];
  unattributed: number;
  outOfScope: number;
  flagged: number;
  media: { variant: string; spend: number; currency: string; impressions: number; linkClicks: number; lpv: number }[];
  results: { key: string; title: string; cells: { label: string; n: number | null }[]; base: number }[];
  pendingReview: number;
  canSeeResponses: boolean;
};

const DISTRIBUTIONS = ["exposicion", "actividad", "descanso", "episodio_descanso", "comida", "friccion_comida", "friccion_movilidad", "compra_fuera", "insatisfaccion", "prioridad"];

export async function loadDashboard(db: Db, experimentId: string, def: SurveyDefinition, cohorts: Cohort[]): Promise<Dashboard> {
  const [{ data: sessions, error: sErr }, { data: responses }, { data: media }] = await Promise.all([
    db.from("survey_sessions").select("id, variant_code, started_at, outcome, attribution, flagged, quick_tap").eq("experiment_id", experimentId).in("cohort", cohorts).limit(20000),
    db.from("survey_responses").select("session_id, eligible, useful, answers, review_status").eq("experiment_id", experimentId).in("cohort", cohorts).limit(20000),
    db.from("ad_metrics_daily").select("variant_code, spend, currency, impressions, link_clicks, landing_page_views").eq("experiment_id", experimentId),
  ]);
  const canSeeResponses = !sErr && sessions !== null;
  const ss = (sessions ?? []).filter((s) => !s.flagged).map((s) => ({ id: s.id, variant: s.variant_code, started: !!s.started_at, outcome: s.outcome }));
  const rs = (responses ?? []).filter((r) => r.review_status !== "descartada");
  const input = { sessions: ss, responses: rs.map((r) => ({ session_id: r.session_id, eligible: r.eligible, useful: r.useful })) };
  const variants = [...new Set(ss.map((s) => s.variant).filter((v): v is string => !!v))].sort();

  const byVariant = new Map<string, { spend: number; currency: string; impressions: number; linkClicks: number; lpv: number }>();
  for (const m of media ?? []) {
    const k = m.variant_code ?? "sin variante";
    const acc = byVariant.get(k) ?? { spend: 0, currency: m.currency, impressions: 0, linkClicks: 0, lpv: 0 };
    acc.spend += Number(m.spend);
    acc.impressions += m.impressions ?? 0;
    acc.linkClicks += m.link_clicks ?? 0;
    acc.lpv += m.landing_page_views ?? 0;
    byVariant.set(k, acc);
  }

  // Resultados: solo elegibles; una dimensión por vez; cortes < 5 suprimidos (y su complementario).
  const eligible = rs.filter((r) => r.eligible).map((r) => r.answers as unknown as Answers);
  const results = DISTRIBUTIONS.map((id) => {
    const q = def.questions.find((x) => x.id === id)!;
    const counts = new Map<string, number>();
    for (const a of eligible) {
      const x = a.items[id];
      const v = x?.omitted ? "__omitida" : x?.choice ?? "__sin_respuesta";
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const labels = new Map([...q.options.map((o) => [o.value, o.label] as const), ["__omitida", "Omitida"], ["__sin_respuesta", "Sin respuesta"]]);
    const cells = suppress([...counts].map(([key, n]) => ({ key, n }))).map((c) => ({ label: labels.get(c.key) ?? c.key, n: c.n }));
    return { key: id, title: q.title, cells, base: eligible.length };
  });
  const seg = new Map<string, number>();
  for (const a of eligible) for (const s of segmentsOf(a)) seg.set(s, (seg.get(s) ?? 0) + 1);
  results.unshift({ key: "segmentos", title: "Segmentos (no excluyentes)", cells: suppress([...seg].map(([key, n]) => ({ key, n }))).map((c) => ({ label: c.key, n: c.n })), base: eligible.length });

  return {
    funnelAll: funnel(input),
    funnelByVariant: variants.map((v) => ({ variant: v, stages: funnel(input, v) })),
    unattributed: (sessions ?? []).filter((s) => s.attribution === "desconocido").length,
    outOfScope: ss.filter((s) => s.outcome === "fuera_de_alcance").length,
    flagged: (sessions ?? []).filter((s) => s.flagged).length,
    media: [...byVariant].map(([variant, v]) => ({ variant, ...v })),
    results,
    pendingReview: rs.filter((r) => r.review_status === "pendiente").length,
    canSeeResponses,
  };
}
