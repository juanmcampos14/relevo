"use client";

import { createClient } from "@/lib/supabase/client";
import { CAPTURE_BUCKET, retryDelayMs, syncOne, type CaptureApi, type OutboxItem } from "@/domain/capture";
import { deleteOutbox, putOutbox, refreshOutbox } from "./outbox";

let running: Promise<number> | null = null;
const nextTry = new Map<string, number>();

function api(): CaptureApi {
  const supabase = createClient();
  return {
    upload: async (path, data, contentType) => {
      const { error } = await supabase.storage.from(CAPTURE_BUCKET).upload(path, data, { contentType, upsert: false });
      return { error: error as { message?: string; statusCode?: string } | null };
    },
    createCapture: async (payload) => {
      const { data, error } = await supabase.rpc("create_capture", { p: payload });
      return { error, id: (data as string | null) ?? null };
    },
  };
}

/**
 * Sube lo que haya en la cola. Una sola corrida a la vez por pestaña, y entre pestañas
 * con Web Locks cuando existe (igual, el alta es idempotente: no hay duplicados).
 * `force` ignora la espera entre reintentos (botón "Reintentar"). Devuelve cuántas subió.
 */
export function syncOutbox({ force = false, slug }: { force?: boolean; slug?: string } = {}): Promise<number> {
  if (running) return running;
  const work = async () => {
    const items = await refreshOutbox();
    let done = 0;
    for (const item of items) {
      if (!force && (item.state === "error" || (nextTry.get(item.clientId) ?? 0) > Date.now())) continue;
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      await putOutbox({ ...item, state: "subiendo" });
      const res = await syncOne(item, api());
      if (res.ok) {
        // Con "Procesar con IA": se pide el procesamiento apenas llega (el servidor no lo repite si ya corrió).
        if (item.aiConsent && res.id && slug) {
          fetch(`/w/${slug}/capturas/${res.id}/procesar`, { method: "POST", keepalive: true }).catch(() => {});
        }
        await deleteOutbox(item.clientId);
        nextTry.delete(item.clientId);
        done++;
      } else {
        const attempts = item.attempts + 1;
        nextTry.set(item.clientId, Date.now() + retryDelayMs(attempts));
        const next: OutboxItem = { ...item, attempts, lastError: res.message, state: res.retry ? "pendiente" : "error" };
        await putOutbox(next);
        if (res.retry) break; // sin señal: no tiene sentido probar las demás ahora
      }
    }
    return done;
  };
  const locked = (): Promise<number> =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("relevo-capturas-sync", work).then((n) => n)
      : work();
  const p = locked().finally(() => {
    running = null;
  });
  running = p;
  return p;
}
