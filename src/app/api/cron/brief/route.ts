import { after, NextResponse, type NextRequest } from "next/server";
import { chainStep, runStep, startDailyBriefs } from "@/server/brief/run";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/brief  (Authorization: Bearer $CRON_SECRET — Vercel Cron lo envía solo)
 * Sin parámetros: arranca el Morning Brief del día en cada workspace que lo tiene activado.
 * ?brief=<id>: corre el próximo paso de ese brief. Responde enseguida; el paso corre después.
 * Idempotente: volver a llamarla retoma lo pendiente (paso fallido o envíos sin entregar).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const one = request.nextUrl.searchParams.get("brief");
  if (one && !/^[0-9a-f-]{36}$/.test(one)) return NextResponse.json({ error: "brief inválido" }, { status: 400 });
  const ids = one ? [one] : await startDailyBriefs();
  after(async () => {
    for (const id of ids) {
      const out = await runStep(id);
      if (out.more) await chainStep(id);
    }
  });
  return NextResponse.json({ scheduled: ids }, { status: 202 });
}
