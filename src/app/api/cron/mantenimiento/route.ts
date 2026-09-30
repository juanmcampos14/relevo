import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeExpired } from "@/server/voice/experiment";

export const dynamic = "force-dynamic";

/** GET /api/cron/mantenimiento (Bearer $CRON_SECRET): borra sesiones y respuestas vencidas por plazo de conservación. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const purged = await purgeExpired(createAdminClient());
  console.info("mantenimiento", JSON.stringify({ purged }));
  return NextResponse.json({ purged });
}
