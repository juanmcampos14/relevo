// Captura rápida: reglas puras (sin navegador ni base) para poder testearlas.

export type CaptureMediaKind = "photo" | "audio";

export type CaptureLocation = { lat: number; lng: number; accuracy: number | null };

/** Lo que se guarda en el teléfono antes de subir. Los archivos van como ArrayBuffer (Safari guarda mejor que Blob). */
export type OutboxMedia = { id: string; kind: CaptureMediaKind; mimeType: string; data: ArrayBuffer; durationMs?: number };

export type OutboxItem = {
  clientId: string;
  workspaceId: string;
  body: string;
  capturedAt: string;
  location: CaptureLocation | null;
  aiConsent: boolean;
  campaignId: string | null;
  media: OutboxMedia[];
  state: "pendiente" | "subiendo" | "error";
  attempts: number;
  lastError?: string;
};

export const CAPTURE_BUCKET = "captures";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

/** "audio/webm;codecs=opus" → "audio/webm". El bucket compara el tipo sin parámetros. */
export function baseMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function isAllowedMime(mime: string): boolean {
  return baseMime(mime) in EXT;
}

/** Ruta determinística: reintentar la subida escribe el mismo archivo, nunca uno nuevo. */
export function mediaPath(workspaceId: string, clientId: string, media: Pick<OutboxMedia, "id" | "mimeType">): string {
  return `${workspaceId}/${clientId}/${media.id}.${EXT[baseMime(media.mimeType)] ?? "bin"}`;
}

export function isEmptyCapture(c: { body: string; location: CaptureLocation | null; media: unknown[] }): boolean {
  return c.body.trim() === "" && c.location === null && c.media.length === 0;
}

/** Payload de create_capture (misma forma que espera la función SQL). */
export function captureRpcPayload(item: OutboxItem) {
  return {
    workspace_id: item.workspaceId,
    client_id: item.clientId,
    body: item.body,
    captured_at: item.capturedAt,
    latitude: item.location?.lat ?? null,
    longitude: item.location?.lng ?? null,
    location_accuracy_m: item.location?.accuracy ?? null,
    campaign_id: item.campaignId,
    ai_consent: item.aiConsent,
    media: item.media.map((m) => ({
      kind: m.kind,
      storage_path: mediaPath(item.workspaceId, item.clientId, m),
      mime_type: baseMime(m.mimeType),
      size_bytes: m.data.byteLength,
      duration_ms: m.durationMs ?? null,
    })),
  };
}

/** Un archivo que ya existe en el bucket es una subida anterior que llegó: cuenta como éxito. */
export function isAlreadyUploaded(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return String(error.statusCode) === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

/** Error de red (sin señal): se reintenta sin marcar la captura como fallida. */
export function isNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(msg);
}

/** Espera entre reintentos: 5 s, 15 s, 45 s… con techo de 5 minutos. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5_000 * 3 ** Math.max(0, attempts - 1), 300_000);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type CaptureApi = {
  upload(path: string, data: ArrayBuffer, contentType: string): Promise<{ error: { message?: string; statusCode?: string | number } | null }>;
  createCapture(payload: ReturnType<typeof captureRpcPayload>): Promise<{ error: { message?: string; code?: string } | null; id?: string | null }>;
};

export type SyncResult = { ok: true; id: string | null } | { ok: false; retry: boolean; message: string };

/**
 * Sube una captura: primero los archivos (ruta fija, un duplicado cuenta como éxito),
 * después el alta atómica e idempotente. Sin señal → reintentar; error de datos o
 * permisos → queda en el teléfono marcada con error, nunca se descarta.
 */
export async function syncOne(item: OutboxItem, api: CaptureApi): Promise<SyncResult> {
  try {
    for (const m of item.media) {
      const { error } = await api.upload(mediaPath(item.workspaceId, item.clientId, m), m.data, baseMime(m.mimeType));
      if (error && !isAlreadyUploaded(error)) return failure(error);
    }
    const { error, id } = await api.createCapture(captureRpcPayload(item));
    if (error) return failure(error);
    return { ok: true, id: id ?? null };
  } catch (e) {
    return failure(e);
  }
}

function failure(error: unknown): SyncResult {
  const e = error as { message?: string; statusCode?: string | number; code?: string };
  if (isNetworkError(error) || String(e?.statusCode ?? "").startsWith("5")) {
    return { ok: false, retry: true, message: "Sin conexión: se reintenta sola." };
  }
  if (/jwt|token|unauthori[sz]ed/i.test(e?.message ?? "") || String(e?.statusCode) === "401") {
    return { ok: false, retry: true, message: "La sesión venció: volvé a entrar y se sube sola." };
  }
  if (e?.code === "42501" || String(e?.statusCode) === "403") {
    return { ok: false, retry: false, message: "No tenés permiso para cargar capturas en este workspace." };
  }
  return { ok: false, retry: false, message: `No se pudo subir: ${e?.message ?? "error desconocido"}` };
}
