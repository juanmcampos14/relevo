import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncWorkspaceSheet } from "@/server/sheet/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sheet (Bearer $CRON_SECRET): el Sheet operativo como fuente viva. Varias veces por día:
 * si cambió, RELEVO procesa solo lo que cambió (reconciliación); si no, no hace nada.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = createAdminClient();
  const { data: workspaces } = await db.from("workspaces").select("id, settings");
  const targets = (workspaces ?? []).filter((w) => (w.settings as { sheet_sync?: { enabled?: boolean } } | null)?.sheet_sync?.enabled !== false && (w.settings as { sheet_sync?: unknown } | null)?.sheet_sync);
  after(async () => {
    for (const w of targets) {
      const r = await syncWorkspaceSheet(db, w.id, w.settings, "cron").catch((e) => ({ status: "error", error: (e as Error).message }));
      console.info("sheet", w.id, JSON.stringify(r));
    }
  });
  return NextResponse.json({ scheduled: targets.map((w) => w.id) }, { status: 202 });
}
