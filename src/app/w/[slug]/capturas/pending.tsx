"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Loader2, MapPin, Mic, RotateCw } from "lucide-react";
import { Section, formatDate } from "@/components/app/bits";
import { useCapture, useOutbox } from "@/components/app/capture/capture-dock";

const stateLabel = { pendiente: "Pendiente de subir", subiendo: "Subiendo…", error: "Error" } as const;

/** Lo que todavía está solo en este teléfono. Nunca se borra sin que la base confirme. */
export function PendingCaptures() {
  const items = useOutbox();
  const { sync } = useCapture();
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;

  async function retry() {
    setBusy(true);
    const n = await sync(true);
    setBusy(false);
    if (n === 0 && !navigator.onLine) {
      toast.error("Sin señal. Quedan guardadas en el teléfono.");
    }
  }

  return (
    <Section
      title="En este teléfono"
      className="mb-8"
      actions={
        <button type="button" onClick={retry} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCw className="size-4" aria-hidden="true" />}
          Reintentar ahora
        </button>
      }
    >
      <ul className="divide-y rounded-xl border border-amber-500/30 bg-card shadow-xs">
        {items.map((i) => {
          const photos = i.media.filter((m) => m.kind === "photo").length;
          const audios = i.media.filter((m) => m.kind === "audio").length;
          return (
            <li key={i.clientId} className="space-y-1 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <time dateTime={i.capturedAt}>{formatDate(i.capturedAt, true)}</time>
                <span className={i.state === "error" ? "font-medium text-destructive" : "font-medium text-amber-700 dark:text-amber-400"}>
                  {stateLabel[i.state]}
                </span>
                {photos > 0 && <span className="inline-flex items-center gap-1"><ImageIcon className="size-3.5" aria-hidden="true" />{photos}</span>}
                {audios > 0 && <span className="inline-flex items-center gap-1"><Mic className="size-3.5" aria-hidden="true" />{audios}</span>}
                {i.location && <MapPin className="size-3.5" aria-label="Con ubicación" />}
              </div>
              {i.body && <p className="line-clamp-2">{i.body}</p>}
              {i.lastError && <p className={i.state === "error" ? "text-destructive" : "text-muted-foreground"}>{i.lastError}</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
