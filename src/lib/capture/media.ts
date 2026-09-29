"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reduce la foto a ≤ 2048 px en JPEG antes de guardarla: en Añelo la señal es mala y
 * una foto de iPhone pesa 3–5 MB. Si el navegador no puede decodificarla, va la original.
 */
export async function compressPhoto(file: File): Promise<{ data: ArrayBuffer; mimeType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (blob && blob.size < file.size) return { data: await blob.arrayBuffer(), mimeType: "image/jpeg" };
  } catch {
    // Formato que el navegador no decodifica (p. ej. HEIC fuera de Safari): se guarda tal cual.
  }
  return { data: await file.arrayBuffer(), mimeType: file.type || "image/jpeg" };
}

/**
 * Chrome/Android: WebM/Opus (al detener se le escribe la duración, que el grabador no guarda).
 * Safari/iPhone no graba WebM y cae en MP4/AAC, que sí trae duración.
 * (MP4/Opus de Chrome no trae duración ni se puede corregir: los reproductores muestran 0:00.)
 */
function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
}

export type RecordedAudio = { data: ArrayBuffer; mimeType: string; durationMs: number };

/**
 * Grabación de audio en el navegador. Mantiene la pantalla encendida mientras graba
 * (si el teléfono se bloquea, iOS corta el micrófono).
 */
export function useRecorder(onDone: (audio: RecordedAudio) => void) {
  const [state, setState] = useState<"idle" | "recording" | "error">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; started: number; timer: number; lock: WakeLockSentinel | null } | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("Este navegador no permite grabar audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMime();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const lock = await navigator.wakeLock?.request("screen").catch(() => null) ?? null;
      const started = Date.now();
      const timer = window.setInterval(() => setElapsed(Date.now() - started), 500);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const r = rec.current;
        rec.current = null;
        if (!r) return;
        window.clearInterval(r.timer);
        r.lock?.release().catch(() => {});
        const durationMs = Date.now() - r.started;
        let blob = new Blob(r.chunks, { type: mr.mimeType || mimeType || "audio/mp4" });
        if (blob.type.startsWith("audio/webm")) {
          try {
            const { default: fixWebmDuration } = await import("fix-webm-duration");
            blob = await fixWebmDuration(blob, durationMs, { logger: false });
          } catch {
            // Sin duración escrita el audio igual se guarda y se transcribe.
          }
        }
        setState("idle");
        setElapsed(0);
        if (blob.size) doneRef.current({ data: await blob.arrayBuffer(), mimeType: blob.type, durationMs });
      };
      rec.current = { mr, chunks, started, timer, lock };
      mr.start(1000);
      setState("recording");
    } catch (e) {
      setState("error");
      setError(e instanceof DOMException && e.name === "NotAllowedError"
        ? "Sin permiso para usar el micrófono. Habilitalo en el navegador."
        : "No se pudo iniciar la grabación.");
    }
  }, []);

  const stop = useCallback(() => rec.current?.mr.state === "recording" && rec.current.mr.stop(), []);

  useEffect(() => () => {
    if (rec.current?.mr.state === "recording") rec.current.mr.stop();
  }, []);

  return { state, elapsed, error, start, stop };
}

export type GeoState =
  | { status: "buscando" }
  | { status: "ok"; lat: number; lng: number; accuracy: number | null }
  | { status: "sin_ubicacion"; reason: string };

export function locate(): Promise<GeoState> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ status: "sin_ubicacion", reason: "El navegador no da ubicación" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: "ok", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      (e) => resolve({ status: "sin_ubicacion", reason: e.code === e.PERMISSION_DENIED ? "Sin permiso de ubicación" : "No se pudo obtener la ubicación" }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
