import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAttribution } from "@/domain/voice/survey";
import { EventInput, SessionInput, SubmitInput, createSession, loadPublicExperiment, recordEvent, submitResponse } from "@/server/voice/experiment";

export const dynamic = "force-dynamic";
const MAX_BYTES = 64 * 1024;

/**
 * POST /api/r/{slug}  { action: "sesion" | "evento" | "respuesta", ... }
 * Ruta pública del formulario. Sin sesión de usuario; todo se valida en el servidor.
 * Respuestas mínimas: nunca devuelve datos guardados.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/r/[slug]">) {
  const { slug } = await ctx.params;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return NextResponse.json({ error: "muy_grande" }, { status: 413 });
  let body: { action?: string } & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }
  const db = createAdminClient();
  const e = await loadPublicExperiment(db, slug);
  if (!e) return NextResponse.json({ error: "no_existe" }, { status: 404 });

  if (body.action === "sesion") {
    const input = SessionInput.safeParse(body);
    if (!input.success) return NextResponse.json({ error: "invalida" }, { status: 400 });
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
    const attribution = parseAttribution(new URLSearchParams(input.data.params), input.data.referrer ?? null, e.variants);
    const out = await createSession(db, e, input.data, ip, attribution);
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.error === "limite" ? 429 : 403 });
    return NextResponse.json({ sessionId: out.sessionId, quickTap: out.quickTap, cohort: out.cohort });
  }
  if (body.action === "evento") {
    const input = EventInput.safeParse(body);
    if (!input.success) return NextResponse.json({ error: "invalida" }, { status: 400 });
    await recordEvent(db, e, input.data);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "respuesta") {
    const input = SubmitInput.safeParse(body);
    if (!input.success) return NextResponse.json({ error: "invalida" }, { status: 400 });
    const out = await submitResponse(db, e, input.data);
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.error === "ya_enviada" ? 409 : 400 });
    return NextResponse.json({ ok: true, code: out.code });
  }
  return NextResponse.json({ error: "accion" }, { status: 400 });
}
