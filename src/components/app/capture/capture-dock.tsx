"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CloudUpload, ImagePlus, Loader2, MapPin, MapPinOff, Mic, Plus, Square, Trash2, WifiOff } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDuration, isEmptyCapture, type OutboxMedia } from "@/domain/capture";
import { outboxStore, putOutbox, refreshOutbox, requestPersistence } from "@/lib/capture/outbox";
import { syncOutbox } from "@/lib/capture/sync";
import { compressPhoto, locate, useRecorder, type GeoState } from "@/lib/capture/media";
import { CAPTURE_CONFIG_KEY } from "@/lib/capture/config";

type Ctx = { open: () => void; slug: string; sync: (force?: boolean) => Promise<number> };
const CaptureContext = createContext<Ctx | null>(null);

export function useCapture() {
  const ctx = useContext(CaptureContext);
  if (!ctx) throw new Error("CaptureProvider ausente");
  return ctx;
}

export function useOutbox() {
  return useSyncExternalStore(outboxStore.subscribe, outboxStore.getSnapshot, outboxStore.getServerSnapshot);
}

function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("online", fn);
      window.addEventListener("offline", fn);
      return () => {
        window.removeEventListener("online", fn);
        window.removeEventListener("offline", fn);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

type Props = {
  children: ReactNode;
  slug: string;
  workspaceId: string;
  campaignId: string | null;
  aiAllowed: boolean;
  canEdit: boolean;
};

/**
 * + Capturar en todo el workspace: botón fijo, hoja de captura y subida en segundo plano.
 * La cola se sube al abrir la app, al recuperar señal, al volver a la pestaña y cada 30 s.
 */
export function CaptureProvider({ children, slug, workspaceId, campaignId, aiAllowed, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const sync = useCallback(
    (force = false) =>
      syncOutbox({ force })
        .then((n) => {
          if (n > 0) {
            toast.success(n === 1 ? "Captura subida" : `${n} capturas subidas`);
            router.refresh();
          }
          return n;
        })
        .catch(() => 0),
    [router],
  );

  // El teléfono recuerda con qué workspace capturar si mañana abre RELEVO sin señal.
  useEffect(() => {
    try {
      localStorage.setItem(CAPTURE_CONFIG_KEY, JSON.stringify({ slug, workspaceId, campaignId, aiAllowed, canEdit }));
    } catch {
      // Navegación privada: sin modo offline, el resto funciona.
    }
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [slug, workspaceId, campaignId, aiAllowed, canEdit]);

  useEffect(() => {
    if (!canEdit) return;
    const run = () => void sync();
    refreshOutbox().then(run).catch(() => {});
    requestPersistence();
    const onVisible = () => document.visibilityState === "visible" && run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(run, 30_000);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [canEdit, sync]);

  const value = useMemo(() => ({ open: () => setOpen(true), slug, sync }), [slug, sync]);

  return (
    <CaptureContext.Provider value={value}>
      {children}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex h-14 items-center gap-2 rounded-full bg-primary pr-5 pl-4 text-base font-semibold text-primary-foreground shadow-lg active:scale-95 md:right-6 md:bottom-6"
          >
            <Plus className="size-6" aria-hidden="true" />
            Capturar
          </button>
          <CaptureSheet
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            campaignId={campaignId}
            aiAllowed={aiAllowed}
            onSaved={() => void sync()}
          />
        </>
      )}
    </CaptureContext.Provider>
  );
}

/** Aviso en la barra superior: cuántas capturas esperan en el teléfono. */
export function PendingCapturesBadge() {
  const { slug } = useCapture();
  const items = useOutbox();
  const online = useOnline();
  if (!items.length && online) return null;
  const failed = items.some((i) => i.state === "error");
  return (
    <Link
      href={`/w/${slug}/capturas`}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
        failed ? "border-destructive/40 text-destructive" : "border-amber-500/40 text-amber-700 dark:text-amber-400",
      )}
    >
      {online ? <CloudUpload className="size-4" aria-hidden="true" /> : <WifiOff className="size-4" aria-hidden="true" />}
      {items.length ? `${items.length} por subir` : "Sin señal"}
    </Link>
  );
}

type Draft = { body: string; media: (OutboxMedia & { preview?: string })[]; useLocation: boolean; aiConsent: boolean };
const emptyDraft = (aiAllowed: boolean): Draft => ({ body: "", media: [], useLocation: true, aiConsent: aiAllowed });

function CaptureSheet({ open, onOpenChange, workspaceId, campaignId, aiAllowed, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: string;
  campaignId: string | null;
  aiAllowed: boolean;
  onSaved: () => void;
}) {
  // El borrador vive fuera de la hoja: cerrarla sin querer no pierde nada.
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(aiAllowed));
  const [geo, setGeo] = useState<GeoState>({ status: "buscando" });
  const [saving, setSaving] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);

  const addAudio = useCallback((a: { data: ArrayBuffer; mimeType: string; durationMs: number }) => {
    setDraft((d) => ({ ...d, media: [...d.media, { id: crypto.randomUUID(), kind: "audio", ...a }] }));
  }, []);
  const recorder = useRecorder(addAudio);

  const refreshGeo = useCallback(() => {
    setGeo({ status: "buscando" });
    locate().then(setGeo);
  }, []);

  // Al abrir se pide la ubicación; después se refresca a mano con "Reintentar".
  const needsGeo = open && geo.status !== "ok";
  useEffect(() => {
    if (!needsGeo) return;
    let alive = true;
    locate().then((g) => alive && setGeo(g));
    return () => {
      alive = false;
    };
  }, [needsGeo]);

  const location = draft.useLocation && geo.status === "ok" ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : null;
  const empty = isEmptyCapture({ body: draft.body, location, media: draft.media });

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return;
    setBusyPhoto(true);
    try {
      for (const f of Array.from(files)) {
        const { data, mimeType } = await compressPhoto(f);
        const preview = URL.createObjectURL(new Blob([data], { type: mimeType }));
        setDraft((d) => ({ ...d, media: [...d.media, { id: crypto.randomUUID(), kind: "photo", data, mimeType, preview }] }));
      }
    } finally {
      setBusyPhoto(false);
    }
  }

  function removeMedia(id: string) {
    setDraft((d) => {
      const m = d.media.find((x) => x.id === id);
      if (m?.preview) URL.revokeObjectURL(m.preview);
      return { ...d, media: d.media.filter((x) => x.id !== id) };
    });
  }

  async function save() {
    if (empty || saving || recorder.state === "recording") return;
    setSaving(true);
    try {
      await putOutbox({
        clientId: crypto.randomUUID(),
        workspaceId,
        body: draft.body,
        capturedAt: new Date().toISOString(),
        location,
        aiConsent: aiAllowed && draft.aiConsent,
        campaignId,
        media: draft.media.map(({ id, kind, mimeType, data, durationMs }) => ({ id, kind, mimeType, data, durationMs })),
        state: "pendiente",
        attempts: 0,
      });
    } catch {
      setSaving(false);
      toast.error("No se pudo guardar en el teléfono (¿navegación privada o sin espacio?). La captura sigue abierta.");
      return;
    }
    draft.media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
    setDraft(emptyDraft(aiAllowed));
    setSaving(false);
    onOpenChange(false);
    toast.success(navigator.onLine ? "Captura guardada. Subiendo…" : "Captura guardada en el teléfono. Se sube sola cuando haya señal.");
    onSaved();
  }

  function discard() {
    draft.media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
    setDraft(emptyDraft(aiAllowed));
    onOpenChange(false);
  }

  const bigBtn = "flex h-14 flex-1 items-center justify-center gap-2 rounded-xl border text-base font-medium active:scale-[0.98] disabled:opacity-50";

  return (
    <Sheet open={open} onOpenChange={(o) => (recorder.state === "recording" ? undefined : onOpenChange(o))}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-lg">
        <SheetHeader className="pb-0">
          <SheetTitle className="text-lg">Nueva captura</SheetTitle>
          <SheetDescription>Se guarda al instante en el teléfono. Después se ordena y se revisa.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <label className="block">
            <span className="sr-only">Nota</span>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              rows={4}
              placeholder="Qué viste, con quién hablaste, qué te dijeron…"
              className="w-full rounded-xl border bg-card p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <div className="flex gap-3">
            {recorder.state === "recording" ? (
              <button type="button" onClick={recorder.stop} className={cn(bigBtn, "border-destructive bg-destructive/10 text-destructive")}>
                <Square className="size-5 fill-current" aria-hidden="true" />
                Detener {formatDuration(recorder.elapsed)}
              </button>
            ) : (
              <button type="button" onClick={recorder.start} className={bigBtn}>
                <Mic className="size-5" aria-hidden="true" />
                Grabar audio
              </button>
            )}
            <label className={cn(bigBtn, "cursor-pointer", (busyPhoto || recorder.state === "recording") && "pointer-events-none opacity-50")}>
              {busyPhoto ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <ImagePlus className="size-5" aria-hidden="true" />}
              Foto
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { onPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {recorder.state === "recording" && (
            <p role="status" className="text-sm text-muted-foreground">Grabando. Mantené la pantalla encendida hasta detener.</p>
          )}
          {recorder.error && <p role="alert" className="text-sm text-destructive">{recorder.error}</p>}

          {draft.media.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {draft.media.map((m) => (
                <li key={m.id} className="relative">
                  {m.kind === "photo" && m.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:)
                    <img src={m.preview} alt="Foto adjunta" className="size-20 rounded-lg border object-cover" />
                  ) : (
                    <div className="flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-lg border bg-muted text-sm">
                      <Mic className="size-5" aria-hidden="true" />
                      {formatDuration(m.durationMs ?? 0)}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(m.id)}
                    aria-label={m.kind === "photo" ? "Quitar foto" : "Quitar audio"}
                    className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full border bg-background shadow"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex min-h-11 items-center gap-2 rounded-xl bg-muted/60 px-3 text-sm">
            {geo.status === "ok" && draft.useLocation ? (
              <MapPin className="size-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <MapPinOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="flex-1">
              {geo.status === "buscando" && "Buscando ubicación…"}
              {geo.status === "ok" && (draft.useLocation
                ? `Ubicación GPS${geo.accuracy ? ` ±${Math.round(geo.accuracy)} m` : ""} (sin verificar)`
                : "No se adjunta ubicación")}
              {geo.status === "sin_ubicacion" && geo.reason}
            </span>
            {geo.status === "ok" ? (
              <button type="button" className="h-9 px-2 text-primary" onClick={() => setDraft((d) => ({ ...d, useLocation: !d.useLocation }))}>
                {draft.useLocation ? "Quitar" : "Adjuntar"}
              </button>
            ) : geo.status === "sin_ubicacion" ? (
              <button type="button" className="h-9 px-2 text-primary" onClick={refreshGeo}>Reintentar</button>
            ) : null}
          </div>

          <label className={cn("flex min-h-11 items-start gap-3 text-sm", !aiAllowed && "text-muted-foreground")}>
            <input
              type="checkbox"
              className="mt-0.5 size-5 accent-primary"
              checked={aiAllowed && draft.aiConsent}
              disabled={!aiAllowed}
              onChange={(e) => setDraft((d) => ({ ...d, aiConsent: e.target.checked }))}
            />
            <span>
              Procesar con IA (transcribir y proponer hechos para revisar)
              {!aiAllowed && <span className="block text-xs">El workspace todavía no habilitó el procesamiento con IA.</span>}
            </span>
          </label>
        </div>

        <div className="flex gap-3 p-4">
          {!empty && (
            <button type="button" onClick={discard} disabled={recorder.state === "recording"} className="h-14 rounded-xl px-4 text-base text-muted-foreground disabled:opacity-50">
              Descartar
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={empty || saving || recorder.state === "recording"}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-50"
          >
            {saving && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
            Guardar
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
