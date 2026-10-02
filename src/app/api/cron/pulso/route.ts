import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pulse } from "@/server/mission/pulse";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/pulso (Bearer $CRON_SECRET): RELEVO como sistema vivo. Durante el día, si algo cambió desde la
 * última síntesis (capturas, mensajes, investigaciones, señales, correcciones), re-evalúa lo que tocaron las
 * señales, re-prioriza el foco, actualiza el estado de la misión y prepara el Avanzar. Si nada cambió, no gasta.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = createAdminClient();
  const { data: missions } = await db.from("campaigns").select("id, workspace_id, ends_on, workspaces(slug, settings)").eq("kind", "mision").eq("status", "activa");
  const active = (missions ?? []).filter((m) => m.workspaces && (!m.ends_on || m.ends_on >= new Date().toISOString().slice(0, 10)));
  after(async () => {
    for (const m of active) {
      const r = await pulse(db, { id: m.id, workspace_id: m.workspace_id, slug: m.workspaces!.slug, settings: m.workspaces!.settings });
      console.info("pulso", m.id, JSON.stringify({ ...r, costUsd: Number(r.costUsd.toFixed(3)) }));
    }
  });
  return NextResponse.json({ scheduled: active.map((m) => m.id) }, { status: 202 });
}
