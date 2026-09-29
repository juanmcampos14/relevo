import "server-only";

// Transcripción detrás de una interfaz: hoy Deepgram; cambiar de proveedor no toca el pipeline.
export type Utterance = { start_ms: number; end_ms: number; text: string };
export type TranscriptionResult =
  | { ok: true; text: string; utterances: Utterance[]; durationMs: number | null; provider: string; model: string; language: string }
  | { ok: false; error: string; retry: boolean; provider: string; model: string };

export type Transcriber = (audio: ArrayBuffer, mimeType: string) => Promise<TranscriptionResult>;

const DG_MODEL = "nova-3";
const DG_LANGUAGE = "es-419"; // español latinoamericano

type DeepgramResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: { alternatives?: { transcript?: string }[] }[];
    utterances?: { start: number; end: number; transcript: string }[];
  };
};

export function deepgramTranscriber(apiKey: string): Transcriber {
  return async (audio, mimeType) => {
    const params = new URLSearchParams({ model: DG_MODEL, language: DG_LANGUAGE, smart_format: "true", punctuate: "true", utterances: "true" });
    let res: Response;
    try {
      res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": mimeType.split(";")[0] },
        body: audio,
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      return { ok: false, error: "Sin conexión con el servicio de transcripción.", retry: true, provider: "deepgram", model: DG_MODEL };
    }
    if (!res.ok) {
      const retry = res.status === 429 || res.status >= 500;
      const error = res.status === 401 || res.status === 403 ? "La clave de Deepgram no es válida o no tiene permiso." : `El servicio de transcripción respondió ${res.status}.`;
      return { ok: false, error, retry, provider: "deepgram", model: DG_MODEL };
    }
    const body = (await res.json()) as DeepgramResponse;
    const text = body.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    const utterances = (body.results?.utterances ?? []).map((u) => ({ start_ms: Math.round(u.start * 1000), end_ms: Math.round(u.end * 1000), text: u.transcript.trim() }));
    return {
      ok: true,
      text,
      utterances,
      durationMs: body.metadata?.duration != null ? Math.round(body.metadata.duration * 1000) : null,
      provider: "deepgram",
      model: DG_MODEL,
      language: DG_LANGUAGE,
    };
  };
}

/** El transcriptor configurado en este entorno, o null si falta la clave. */
export function configuredTranscriber(): Transcriber | null {
  const key = process.env.DEEPGRAM_API_KEY;
  return key ? deepgramTranscriber(key) : null;
}
