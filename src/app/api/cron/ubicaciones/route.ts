import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeAll } from "@/server/geo-bulk";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/ubicaciones?apply=1 (Bearer $CRON_SECRET): ubica en lote establecimientos y activos con la
 * clave de Google Places del entorno (no sale del servidor). Sin apply, en seco. Nunca asigna "confirmada".
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const key = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const probe = key
    ? await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.displayName" }, body: JSON.stringify({ textQuery: "hotel Añelo Neuquén", maxResultCount: 1 }) })
        .then(async (r) => ({ status: r.status, error: r.ok ? null : ((await r.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? null }))
        .catch((e: Error) => ({ status: 0, error: e.message }))
    : { status: 0, error: "Falta GOOGLE_MAPS_API_KEY" };
  if (probe.status !== 200) return NextResponse.json({ google: probe }, { status: 502 });
  const results = await geocodeAll(createAdminClient(), { dryRun: request.nextUrl.searchParams.get("apply") !== "1" });
  const count = (l: string) => results.filter((r) => r.level === l).length;
  return NextResponse.json({ google: probe, summary: { aproximada: count("aproximada"), inferida: count("inferida"), sin_ubicacion: count("sin_ubicacion") }, results: results.map((r) => ({ kind: r.kind, name: r.name, level: r.level, source: r.source ?? null, matched: r.matched ?? null })) });
}
