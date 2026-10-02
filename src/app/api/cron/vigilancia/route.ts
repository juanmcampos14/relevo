import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { watchMission, type WatchConfig } from "@/server/mission/watch";
import { pulse } from "@/server/mission/pulse";
import { siteUrl } from "@/server/brief/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/vigilancia (Bearer $CRON_SECRET): vigilancia activa de cada misión durante el día. Detecta lo
 * nuevo, lo cruza con la misión, lo incorpora y avisa solo si cambia algo material. Si apareció algo, RELEVO
 * vuelve a priorizar (pulso). Si no apareció nada, no gasta.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = createAdminClient();
  const { data: missions } = await db.from("campaigns").select("id, workspace_id, name, objective, ends_on, watch, workspaces(slug, settings)").eq("kind", "mision").eq("status", "activa");
  const active = (missions ?? []).filter((m) => m.workspaces && (!m.ends_on || m.ends_on >= new Date().toISOString().slice(0, 10)));
  after(async () => {
    for (const m of active) {
      const ref = { id: m.id, workspace_id: m.workspace_id, slug: m.workspaces!.slug, settings: m.workspaces!.settings };
      const w = await watchMission(db, { ...ref, name: m.name, objective: m.objective, watch: (m.watch as WatchConfig | null) ?? null }, { siteUrl: siteUrl() }).catch((e) => ({ error: (e as Error).message }));
      console.info("vigilancia", m.id, JSON.stringify(w));
      // Re-priorizar si algo cambió (lo nuevo de la vigilancia, capturas, mensajes, correcciones); si no, no gasta.
      const p = await pulse(db, ref).catch(() => null);
      console.info("vigilancia → pulso", m.id, JSON.stringify(p));
    }
  });
  return NextResponse.json({ scheduled: active.map((m) => m.id) }, { status: 202 });
}
