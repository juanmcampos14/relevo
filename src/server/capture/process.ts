import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { CAPTURE_BUCKET } from "@/domain/capture";
import { buildProposals, locateInAudio } from "@/domain/capture-proposals";
import { formatDuration } from "@/domain/capture";
import { MIN_WORDS, NEAR_DUPLICATE, contentSimilarity, normalizeContent } from "@/domain/capture-dedupe";
import { EXTRACT_MODEL, EXTRACT_PROMPT_VERSION, extractCapture } from "./extract";
import { configuredTranscriber, type Transcriber, type Utterance } from "./transcribe";

type Db = SupabaseClient<Database>;
const DAILY_LIMIT = 60;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProcessResult = { ok: true; proposals: number } | { ok: false; message: string; duplicateOf?: string };

async function sha256(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(await crypto.subtle.digest("SHA-256", buf)).toString("hex");
}

function formatAR(iso: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
}

/**
 * Procesa una captura con IA y deja propuestas para revisar. No escribe empresas, personas,
 * evidencia ni findings: eso lo hace una persona al aceptar cada propuesta.
 */
export async function processCapture(
  db: Db,
  /** force: procesar aunque parezca un duplicado (la persona confirmó que es otra conversación). */
  opts: { workspaceId: string; settings: unknown; userId: string; captureId: string; client?: Anthropic; transcriber?: Transcriber | null; force?: boolean },
): Promise<ProcessResult> {
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
  const audios = capture.capture_media.filter((m) => m.kind === "audio");
  const transcriber = opts.transcriber === undefined ? configuredTranscriber() : opts.transcriber;
  if (!capture.body?.trim() && !photos.length) {
    if (!audios.length) return { ok: false, message: "La captura no tiene texto, fotos ni audio para procesar." };
    if (!transcriber) return { ok: false, message: "Solo tiene audio y la transcripción no está configurada en este entorno (falta DEEPGRAM_API_KEY)." };
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).eq("user_id", opts.userId).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, message: `Llegaste al límite de ${DAILY_LIMIT} usos de IA en 24 horas.` };

  // Reserva: una sola corrida por captura aunque se toque dos veces o haya dos pestañas.
  const { data: claimed } = await db.from("captures").update({ status: "procesando", status_error: null, ...(opts.force ? { duplicate_of: null } : {}) }).eq("id", capture.id).in("status", opts.force ? ["guardado", "error", "duplicado"] : ["guardado", "error"]).select("id");
  if (!claimed?.length) return { ok: false, message: capture.status === "procesando" ? "Ya se está procesando." : "La captura ya tiene propuestas." };

  const fail = async (message: string, runId: string | null) => {
    await db.from("captures").update({ status: "error", status_error: message, ai_run_id: runId }).eq("id", capture.id);
    return { ok: false as const, message };
  };

  let duplicateOf: string | null = null;
  try {
    // 1. Audio → transcripción (una vez por archivo; el audio original queda intacto).
    const transcribed: { mediaId: string; text: string; utterances: Utterance[]; durationMs: number | null }[] = [];
    const notes: string[] = [];
    if (audios.length) {
      const { data: existing } = await db.from("transcripts").select("capture_media_id, status, text, utterances, duration_ms").eq("capture_id", capture.id);
      for (const [i, a] of audios.entries()) {
        const prev = existing?.find((t) => t.capture_media_id === a.id && t.status === "ok");
        if (prev) {
          transcribed.push({ mediaId: a.id, text: prev.text ?? "", utterances: (prev.utterances ?? []) as Utterance[], durationMs: prev.duration_ms });
          continue;
        }
        if (!transcriber) {
          notes.push(`Audio ${i + 1}: sin transcribir (falta configurar la transcripción).`);
          continue;
        }
        const { data: file } = await db.storage.from(CAPTURE_BUCKET).download(a.storage_path);
        const bytes = file ? await file.arrayBuffer() : null;
        if (bytes) {
          // Huella del audio: el mismo archivo subido dos veces es la misma conversación.
          const hash = await sha256(bytes);
          await db.from("capture_media").update({ sha256: hash }).eq("id", a.id);
          if (!opts.force && !duplicateOf) {
            const { data: same } = await db.from("capture_media").select("capture_id").eq("sha256", hash).neq("capture_id", capture.id).limit(1);
            duplicateOf = same?.[0]?.capture_id ?? null;
          }
        }
        if (duplicateOf) break;
        const t = bytes ? await transcriber(bytes, a.mime_type) : { ok: false as const, error: "No se pudo leer el audio guardado.", retry: true, provider: "—", model: "—" };
        await db.from("transcripts").upsert(
          t.ok
            ? { workspace_id: opts.workspaceId, capture_id: capture.id, capture_media_id: a.id, provider: t.provider, model: t.model, language: t.language, status: "ok", text: t.text, utterances: t.utterances as unknown as NonNullable<Json>, duration_ms: t.durationMs, error: null }
            : { workspace_id: opts.workspaceId, capture_id: capture.id, capture_media_id: a.id, provider: t.provider, model: t.model, status: "error", text: null, error: t.error },
          { onConflict: "capture_media_id" },
        );
        if (t.ok) transcribed.push({ mediaId: a.id, text: t.text, utterances: t.utterances, durationMs: t.durationMs });
        else notes.push(`Audio ${i + 1}: ${t.error}`);
      }
      if (!duplicateOf && !capture.body?.trim() && !photos.length && !transcribed.some((t) => t.text)) {
        return fail(notes.join(" ") || "El audio no tiene habla reconocible.", null);
      }
    }
    // Nota escrita + transcripciones: el mismo texto que ve la IA y contra el que se validan las citas.
    const fullText = [
      capture.body?.trim() || null,
      ...transcribed.filter((t) => t.text).map((t, i) => `[Audio ${i + 1}${t.durationMs ? `, ${formatDuration(t.durationMs)}` : ""}, transcripción automática]\n${t.text}`),
    ].filter(Boolean).join("\n\n");

    // 2. ¿Es la misma conversación que otra captura? Mismo audio, mismo texto o prácticamente idéntico.
    const normalized = normalizeContent(fullText);
    const contentHash = normalized ? await sha256(normalized) : null;
    if (!opts.force && !duplicateOf && contentHash) {
      const { data: exact } = await db.from("captures").select("id").eq("content_hash", contentHash).neq("id", capture.id).limit(1);
      duplicateOf = exact?.[0]?.id ?? null;
      if (!duplicateOf && normalized.split(" ").length >= MIN_WORDS) {
        const { data: recent } = await db
          .from("captures")
          .select("id, body, transcripts(text)")
          .neq("id", capture.id)
          .gte("captured_at", new Date(Date.parse(capture.captured_at) - 60 * 86_400_000).toISOString())
          .order("captured_at", { ascending: false })
          .limit(200);
        const best = (recent ?? [])
          .map((r) => ({ id: r.id, sim: contentSimilarity(normalized, normalizeContent([r.body ?? "", ...r.transcripts.map((t) => t.text ?? "")].join(" "))) }))
          .sort((x, y) => y.sim - x.sim)[0];
        if (best && best.sim >= NEAR_DUPLICATE) duplicateOf = best.id;
      }
    }
    if (duplicateOf) {
      await db.from("captures").update({ status: "duplicado", duplicate_of: duplicateOf, content_hash: contentHash }).eq("id", capture.id);
      return { ok: false, message: "Parece la misma conversación que otra captura: no se procesó para no contarla como una fuente nueva.", duplicateOf };
    }
    await db.from("captures").update({ content_hash: contentHash }).eq("id", capture.id);

    const [companies, contacts, findings, author, mission, images, unresolved] = await Promise.all([
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
      db.from("unresolved_entities").select("id, kind, label").is("resolved_at", null).order("created_at", { ascending: false }).limit(100),
    ]);
    const companyList = (companies.data ?? []).map((c) => ({ id: c.id, name: c.trade_name ?? c.legal_name ?? "", locality: c.locality, website: c.website, phone: c.public_phone }));
    const contactList = (contacts.data ?? []).map((c) => ({
      id: c.id,
      name: c.full_name,
      role: c.role_title,
      company: c.contact_links.map((l) => l.companies?.trade_name ?? l.companies?.legal_name).find(Boolean) ?? null,
    }));
    const findingList = findings.data ?? [];
    const unresolvedList = (unresolved.data ?? []) as { id: string; kind: "organization" | "actor"; label: string }[];

    const result = await extractCapture(opts.client ?? new Anthropic(), {
      capturedAt: formatAR(capture.captured_at),
      capturedBy: author.data?.display_name || author.data?.email || "el equipo",
      missionName: mission.data?.name ?? null,
      location: capture.latitude != null ? `${capture.latitude.toFixed(5)}, ${capture.longitude?.toFixed(5)} (GPS${capture.location_accuracy_m ? ` ±${Math.round(capture.location_accuracy_m)} m` : ""}, sin verificar)` : null,
      body: fullText,
      photos: images.filter((i): i is NonNullable<typeof i> => !!i),
      companies: companyList,
      contacts: contactList,
      findings: findingList,
      unresolved: unresolvedList,
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

    const drafts = buildProposals(result.extraction, { body: fullText, companies: companyList, contacts: contactList, findings: findingList, unresolved: unresolvedList });
    // Evidencia dicha en un audio: se guarda en qué momento del audio está, para escucharla.
    for (const d of drafts) {
      const where = d.kind === "evidence" || d.kind === "person" ? locateInAudio(d.quote, transcribed) : null;
      if (where) d.payload.audio = where;
    }
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
      .update({
        status: drafts.length ? "propuestas_listas" : "revisado",
        ai_summary: [result.extraction.summary, ...notes].join(" "),
        ai_unknowns: result.extraction.unknowns.map((u) => u.trim()).filter(Boolean).slice(0, 5),
        processed_at: new Date().toISOString(),
        ai_run_id: run?.id ?? null,
      })
      .eq("id", capture.id);
    return { ok: true, proposals: drafts.length };
  } catch (e) {
    return fail(`No se pudo procesar la captura: ${(e as Error).message}`, null);
  }
}
