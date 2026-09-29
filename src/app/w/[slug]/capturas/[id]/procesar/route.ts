import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { processCapture } from "@/server/capture/process";

// La extracción con IA puede tardar ~20–60 s.
export const maxDuration = 120;

/** Lo llama el teléfono apenas sube una captura con "Procesar con IA". Idempotente: si ya se procesó, no repite. */
export async function POST(_req: Request, { params }: RouteContext<"/w/[slug]/capturas/[id]/procesar">) {
  const { slug, id } = await params;
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return NextResponse.json({ ok: false, message: "Tu rol es de solo lectura." }, { status: 403 });
  const supabase = await createClient();
  const res = await processCapture(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, captureId: id });
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}
