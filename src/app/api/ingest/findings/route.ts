import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, ingestPayloadSchema } from "@/domain/ingest";
import { ingestFindings } from "@/server/ingest";

const MAX_BYTES = 512 * 1024;

/**
 * POST /api/ingest/findings  (Authorization: Bearer rlv_…)
 * Ingesta automatizada (Morning Brief). El token identifica UN workspace; los
 * ítems quedan como hallazgos pendientes de revisión. Nunca crea oportunidades.
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("rlv_")) return NextResponse.json({ error: "Falta el token de ingesta" }, { status: 401 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return NextResponse.json({ error: "El lote es demasiado grande (máx. 512 KB)" }, { status: 413 });

  const db = createAdminClient();
  const { data: tok } = await db
    .from("ingest_tokens")
    .select("id, workspace_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!tok || tok.revoked_at) return NextResponse.json({ error: "Token inválido o revocado" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo no es JSON válido" }, { status: 400 });
  }
  const payload = ingestPayloadSchema.safeParse(body);
  if (!payload.success) {
    return NextResponse.json({ error: "Formato inválido", details: payload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }

  const report = await ingestFindings(db, tok.workspace_id, payload.data.items, {
    sourceSystem: payload.data.source_system,
    tokenId: tok.id,
  });
  await db.from("ingest_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);
  return NextResponse.json(report, { status: report.created > 0 ? 201 : 200 });
}
