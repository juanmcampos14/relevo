import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { mapRadar } from "@/domain/radar/sheet";
import { parseTab } from "@/server/crm-import/parse";
import { reconcileSource, type SourceRun } from "@/server/reconcile/source";
import type { Fact } from "@/server/reconcile/engine";
import { migrateRadar, type RadarReport } from "./import";

// El Radar del Sheet, reconciliado: activos, precios y filas ya conocidas siguen la importación de siempre
// (respetando lo corregido a mano); cada fila NUEVA es un hecho que se reconcilia contra el Brain antes de
// crear nada (¿ya lo sabíamos?, ¿es material?, ¿qué hipótesis o candidato toca?, triage, próxima acción).

type Db = SupabaseClient<Database>;

export async function reconcileRadar(db: Db, o: { workspaceId: string; missionId: string; buffer: ArrayBuffer; fileName: string; dryRun: boolean; client?: Pick<Anthropic, "beta"> }): Promise<{ import: RadarReport; run: SourceRun }> {
  const report = await migrateRadar(db, o.workspaceId, o.buffer, { dryRun: o.dryRun, newSignals: "omitir" });
  const plan = mapRadar(await parseTab(o.buffer, "RADAR DE MERCADO", "Hallazgo"));
  const fresh = new Set(report.signals.created);
  const facts: Fact[] = plan.signals.filter((s) => fresh.has(s.ref)).map((s) => {
    const asset = plan.assets.find((a) => a.ref === s.ref);
    return {
      key: s.ref,
      statement: s.headline,
      summary: [s.summary, s.implication ? `Lectura del Radar: ${s.implication}` : null].filter(Boolean).join(" · ") || null,
      happened_on: s.happenedOn,
      source_url: s.url,
      basis: s.basis,
      section: s.section,
      signal_type: s.signalType,
      // Una publicación es un activo, no una empresa ni una oportunidad.
      entities: s.entity && s.section !== "activos" ? [{ kind: "empresa" as const, name: s.entity }] : [],
      values: [],
      asset_ids: asset && report.assetIds[asset.ref] ? [report.assetIds[asset.ref]] : [],
    };
  });
  const run = await reconcileSource(db, { workspaceId: o.workspaceId, missionId: o.missionId, origin: "radar_sheet", sourceLabel: "RADAR DE MERCADO (Sheet)", externalRef: true, system: "radar", fileName: o.fileName, content: JSON.stringify(facts), dryRun: o.dryRun }, facts, { client: o.client });
  return { import: report, run };
}
