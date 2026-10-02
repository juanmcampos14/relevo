import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareMoves } from "@/server/mission/moves";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/avanzar (Bearer $CRON_SECRET): después de la síntesis del día, prepara el Avanzar de lo que
 * se ve en el home de cada misión activa (persona encontrada, mensaje listo), para que en la calle tocar
 * Avanzar responda al instante. Solo lo que falta o venció.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = createAdminClient();
  const { data: missions } = await db.from("campaigns").select("id, workspace_id, ends_on, workspaces(slug, settings)").eq("kind", "mision").eq("status", "activa");
  const active = (missions ?? []).filter((m) => m.workspaces && (!m.ends_on || m.ends_on >= new Date().toISOString().slice(0, 10)));
  after(async () => {
    for (const m of active) {
      const r = await prepareMoves(db, { workspaceId: m.workspace_id, campaignId: m.id, slug: m.workspaces!.slug, settings: m.workspaces!.settings });
      console.info("avanzar preparado", m.id, JSON.stringify({ ...r, costUsd: Number(r.costUsd.toFixed(3)) }));
    }
  });
  return NextResponse.json({ scheduled: active.map((m) => m.id) }, { status: 202 });
}
