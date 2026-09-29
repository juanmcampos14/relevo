"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatDuration } from "@/domain/capture";

/**
 * Reproductor de capturas. Los grabadores del navegador a veces no escriben la duración en el archivo
 * (el reproductor nativo muestra 0:00 / 0:00): se usa la duración medida al grabar.
 */
export function AudioPlayer({ src, durationMs }: { src: string; durationMs: number | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [fileMs, setFileMs] = useState<number | null>(null);
  const total = fileMs ?? durationMs ?? 0;

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onMeta = () => setFileMs(Number.isFinite(a.duration) && a.duration > 0 && a.duration < 36_000 ? a.duration * 1000 : null);
    const onTime = () => setPos(a.currentTime * 1000);
    const onEnd = () => setPlaying(false);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", onEnd);
    a.addEventListener("play", () => setPlaying(true));
    return () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("pause", onEnd);
    };
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  };

  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-full border bg-card py-1 pr-4 pl-1">
      <audio ref={ref} src={src} preload="metadata" />
      <button type="button" onClick={toggle} aria-label={playing ? "Pausar audio" : "Reproducir audio"} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        {playing ? <Pause className="size-4 fill-current" aria-hidden="true" /> : <Play className="size-4 fill-current" aria-hidden="true" />}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(total, 1)}
        value={Math.min(pos, total)}
        onChange={(e) => {
          if (ref.current) ref.current.currentTime = Number(e.target.value) / 1000;
        }}
        aria-label="Posición del audio"
        className="h-2 flex-1 accent-primary"
      />
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatDuration(pos)} / {total ? formatDuration(total) : "—"}
      </span>
    </div>
  );
}
