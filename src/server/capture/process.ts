import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { CAPTURE_BUCKET } from "@/domain/capture";
import { buildProposals } from "@/domain/capture-proposals";
import { EXTRACT_MODEL, EXTRACT_PROMPT_VERSION, extractCapture } from "./extract";

type Db = SupabaseClient<Database>;
const DAILY_LIMIT = 60;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProcessResult = { ok: true; proposals: number } | { ok: false; message: string };

function formatAR(iso: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
}

/**
 * Procesa una captura con IA y deja propuestas para revisar. No escribe empresas, personas,
 * evidencia ni findings: eso lo hace una persona al aceptar cada propuesta.
 */
export async function processCapture(db: Db, opts: { workspaceId: string; settings: unknown; userId: string; captureId: string; client?: Anthropic }): Promise<ProcessResult> {
  if ((opts.settings as { ai_processing_consent?: boolean } | null)?.ai_processing_consent !== true) {
    return { ok: false, message: "El workspace no habilitó el procesamiento con IA (Miembros → Procesamiento con IA)." };
  }
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, message: "La IA no está configurada en este entorno." };

  const { data: capture } = await db
    .from("captures")
    .select("id, body, captured_at, captured_by, latitude, longitude, location_accuracy_m, ai_consent, status, campaign_id, capture_media(id, kind, storage_path, mime_type)")
    .eq("id", opts.captureId)
    .maybeSingle();
  if (!capture) return { ok: false, message: "Captura no encontrada." };
  if (!capture.ai_consent) return { ok: false, message: "Esta captura se guardó sin \"Procesar con IA\"." };
  const photos = capture.capture_media.filter((m) => m.kind === "photo" && IMAGE_TYPES.has(m.mime_type));
  if (!capture.body?.trim() && !photos.length) {
    return { ok: false, message: capture.capture_media.some((m) => m.kind === "audio") ? "Solo tiene audio: se procesa cuando esté activa la transcripción." : "La captura no tiene texto ni fotos para procesar." };
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).eq("user_id", opts.userId).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, message: `Llegaste al límite de ${DAILY_LIMIT} usos de IA en 24 horas.` };

  // Reserva: una sola corrida por captura aunque se toque dos veces o haya dos pestañas.
  const { data: claimed } = await db.from("captures").update({ status: "procesando", status_error: null }).eq("id", capture.id).in("status", ["guardado", "error"]).select("id");
  if (!claimed?.length) return { ok: false, message: capture.status === "procesando" ? "Ya se está procesando." : "La captura ya tiene propuestas." };

  const fail = async (message: string, runId: string | null) => {
    await db.from("captures").update({ status: "error", status_error: message, ai_run_id: runId }).eq("id", capture.id);
    return { ok: false as const, message };
  };

  try {
    const [companies, contacts, findings, author, mission, images] = await Promise.all([
      db.from("companies").select("id, trade_name, legal_name, locality, website, public_phone").order("updated_at", { ascending: false }).limit(400),
      db.from("contacts").select("id, full_name, role_title, contact_links(companies(trade_name, legal_name))").order("updated_at", { ascending: false }).limit(400),
      db.from("findings").select("id, statement").neq("review_status", "rechazado").order("created_at", { ascending: false }).limit(150),
      capture.captured_by ? db.from("profiles").select("display_name, email").eq("user_id", capture.captured_by).maybeSingle() : Promise.resolve({ data: null }),
      capture.campaign_id ? db.from("campaigns").select("name").eq("id", capture.campaign_id).maybeSingle() : Promise.resolve({ data: null }),
      Promise.all(
        photos.slice(0, 5).map(async (p) => {
          const { data } = await db.storage.from(CAPTURE_BUCKET).download(p.storage_path);
          return data ? { mediaType: p.mime_type as "image/jpeg", base64: Buffer.from(await data.arrayBuffer()).toString("base64") } : null;
        }),
      ),
    ]);
    const companyList = (companies.data ?? []).map((c) => ({ id: c.id, name: c.trade_name ?? c.legal_name ?? "", locality: c.locality, website: c.website, phone: c.public_phone }));
    const contactList = (contacts.data ?? []).map((c) => ({
      id: c.id,
      name: c.full_name,
      role: c.role_title,
      company: c.contact_links.map((l) => l.companies?.trade_name ?? l.companies?.legal_name).find(Boolean) ?? null,
    }));
    const findingList = findings.data ?? [];

    const result = await extractCapture(opts.client ?? new Anthropic(), {
      capturedAt: formatAR(capture.captured_at),
      capturedBy: author.data?.display_name || author.data?.email || "el equipo",
      missionName: mission.data?.name ?? null,
      location: capture.latitude != null ? `${capture.latitude.toFixed(5)}, ${capture.longitude?.toFixed(5)} (GPS${capture.location_accuracy_m ? ` ±${Math.round(capture.location_accuracy_m)} m` : ""}, sin verificar)` : null,
      body: capture.body,
      photos: images.filter((i): i is NonNullable<typeof i> => !!i),
      companies: companyList,
      contacts: contactList,
      findings: findingList,
    });

    const { data: run } = await db
      .from("ai_runs")
      .insert({
        workspace_id: opts.workspaceId,
        user_id: opts.userId,
        model: EXTRACT_MODEL,
        prompt_version: EXTRACT_PROMPT_VERSION,
        status: result.ok ? "ok" : result.status,
        input_tokens: result.ok ? result.usage.input : 0,
        output_tokens: result.ok ? result.usage.output : 0,
        cache_read_tokens: result.ok ? result.usage.cacheRead : 0,
        cache_write_tokens: result.ok ? result.usage.cacheWrite : 0,
        cost_usd: result.ok ? Number(result.usage.costUsd.toFixed(5)) : 0,
        error: result.ok ? null : result.error,
        duration_ms: result.durationMs,
      })
      .select("id")
      .single();
    if (!result.ok) return fail(result.error, run?.id ?? null);

    const drafts = buildProposals(result.extraction, { body: capture.body, companies: companyList, contacts: contactList, findings: findingList });
    await db.from("proposals").delete().eq("capture_id", capture.id).eq("status", "propuesta");
    if (drafts.length) {
      const { error } = await db.from("proposals").insert(
        drafts.map((d) => ({
          workspace_id: opts.workspaceId,
          capture_id: capture.id,
          kind: d.kind,
          position: d.position,
          payload: d.payload as NonNullable<Json>,
          quote: d.quote,
          matches: d.matches as unknown as NonNullable<Json>,
          ai_run_id: run?.id ?? null,
        })),
      );
      if (error) return fail(`No se pudieron guardar las propuestas (${error.message}).`, run?.id ?? null);
    }
    await db
      .from("captures")
      .update({ status: drafts.length ? "propuestas_listas" : "revisado", ai_summary: result.extraction.summary, processed_at: new Date().toISOString(), ai_run_id: run?.id ?? null })
      .eq("id", capture.id);
    return { ok: true, proposals: drafts.length };
  } catch (e) {
    return fail(`No se pudo procesar la captura: ${(e as Error).message}`, null);
  }
}
