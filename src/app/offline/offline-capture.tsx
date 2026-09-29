"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { LogoMark } from "@/components/app/brand";
import { CaptureProvider } from "@/components/app/capture/capture-dock";
import { PendingCaptures } from "@/app/w/[slug]/capturas/pending";
import { CAPTURE_CONFIG_KEY, readCaptureConfig } from "@/lib/capture/config";

const noop = () => () => {};

/**
 * Modo sin señal: la misma captura de siempre, con la configuración que el teléfono guardó
 * la última vez que abrió RELEVO con conexión. Todo queda en la cola local.
 */
export function OfflineCapture() {
  // Solo existe en el navegador: en el servidor se ve el estado "sin configuración".
  const raw = useSyncExternalStore(noop, () => localStorage.getItem(CAPTURE_CONFIG_KEY), () => null);
  const cfg = readCaptureConfig(raw);

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pt-6 pb-40">
      <div className="mb-6 flex items-center gap-2.5">
        <LogoMark className="size-8" />
        <span className="font-semibold">RELEVO OS</span>
      </div>
      <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="flex items-center gap-2 font-medium">
          <WifiOff className="size-5" aria-hidden="true" />
          Sin conexión
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Podés capturar igual: todo se guarda en este teléfono y se sube solo cuando vuelva la señal.
        </p>
        <Link href={cfg ? `/w/${cfg.slug}` : "/"} className="mt-3 inline-flex h-11 items-center rounded-lg border bg-background px-4 text-sm font-medium">
          Reintentar abrir RELEVO
        </Link>
      </div>
      {cfg ? (
        <CaptureProvider slug={cfg.slug} workspaceId={cfg.workspaceId} campaignId={cfg.campaignId} aiAllowed={cfg.aiAllowed} canEdit={cfg.canEdit}>
          <PendingCaptures />
        </CaptureProvider>
      ) : (
        <p className="text-sm text-muted-foreground">
          Este teléfono todavía no abrió RELEVO con señal. Entrá una vez con conexión y después vas a poder capturar sin señal.
        </p>
      )}
    </div>
  );
}
