import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { briefTargets } from "@/server/mission/targets";
import { synthesizeMission } from "@/server/mission/synthesis";
import { planAog } from "@/server/mission/aog";
import { describeMission } from "@/server/mission/state";
import { reassessFromSignals } from "@/server/mission/pulse";
import { ingestBriefCandidates } from "@/server/mission/ingest";
import { isBriefMission } from "@/server/ai/mission";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TARGETS_EVERY_H = 72;

/**
 * GET /api/cron/mision (Bearer $CRON_SECRET): "RELEVO ya trabajó". Después del Morning Brief y antes de la
 * entrega, prepara cada misión activa: renueva por qué importa cada objetivo (cada 3 días) y la síntesis
 * del día, para que la conversación responda en segundos. Antes, las hipótesis que tocaron las señales del
 * Brief se re-evalúan: una noticia puede fortalecer o debilitar lo que creemos.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = createAdminClient();
  const { data: missions } = await db.from("campaigns").select("id, workspace_id, ends_on, workspaces(slug, settings)").eq("kind", "mision").eq("status", "activa");
  const active = (missions ?? []).filter((m) => !m.ends_on || m.ends_on >= new Date().toISOString().slice(0, 10));
  // Cada misión en paralelo: en serie, los objetivos de una (cada 3 días, ~4 minutos) agotaban el tiempo de
  // la función y la siguiente se quedaba sin síntesis de la mañana (pasó el 4/10 con Añelo).
  after(async () => {
    await Promise.allSettled(active.map(async (m) => {
      const { data: last } = await db.from("campaign_targets").select("briefed_at").eq("campaign_id", m.id).not("briefed_at", "is", null).order("briefed_at").limit(1).maybeSingle();
      const { count: unbriefed } = await db.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", m.id).is("briefed_at", null).not("company_id", "is", null);
      if (unbriefed || !last?.briefed_at || Date.now() - new Date(last.briefed_at).getTime() > TARGETS_EVERY_H * 3_600_000) {
        const t = await briefTargets(db, { workspaceId: m.workspace_id, campaignId: m.id });
        console.info("mision objetivos", m.id, JSON.stringify(t));
      }
      const a = await planAog(db, { workspaceId: m.workspace_id, campaignId: m.id });
      console.info("mision aog", m.id, a.ok ? (a.skipped ? "sin cambios" : `USD ${a.costUsd.toFixed(2)}`) : a.message);
      // Lo que el Brief encontró y es claro entra solo a la memoria (lo dudoso queda como una pregunta).
      if (await isBriefMission(db, m.id)) {
        const ic = await ingestBriefCandidates(db, { workspaceId: m.workspace_id, missionId: m.id });
        console.info("mision candidatos", m.id, JSON.stringify(ic));
      }
      // Lo que el Brief de hoy detectó actualiza lo que creemos antes de priorizar.
      if (m.workspaces) {
        const ra = await reassessFromSignals(db, { id: m.id, workspace_id: m.workspace_id, slug: m.workspaces.slug, settings: m.workspaces.settings }, new Date(Date.now() - 30 * 3_600_000).toISOString());
        console.info("mision re-evaluadas", m.id, ra.reassessed.length);
      }
      const s = await synthesizeMission(db, { workspaceId: m.workspace_id, campaignId: m.id });
      console.info("mision sintesis", m.id, s.ok ? `USD ${s.costUsd.toFixed(2)}` : s.message);
      const e = await describeMission(db, { workspaceId: m.workspace_id, campaignId: m.id });
      console.info("mision estado", m.id, e.ok ? (e.skipped ? "sin cambios" : `USD ${e.costUsd.toFixed(2)}`) : e.message);
    }));
  });
  return NextResponse.json({ scheduled: active.map((m) => m.id) }, { status: 202 });
}
