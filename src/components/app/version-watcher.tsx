"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BUILD_ID } from "@/lib/build";

/**
 * Avisa cuando hay una versión nueva publicada. No recarga solo: podría haber una captura a medio
 * escribir. Revisa al abrir, al volver a la app y cada 5 minutos.
 */
export function VersionWatcher() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (BUILD_ID === "dev") return;
    const check = () =>
      fetch("/api/version", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((v: { id?: string } | null) => {
          if (v?.id && v.id !== BUILD_ID) setOutdated(true);
        })
        .catch(() => {});
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const t = window.setInterval(check, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(t);
    };
  }, []);
  if (!outdated) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-sidebar px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm text-white shadow-lg">
      <span>Hay una versión nueva de RELEVO.</span>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground">
        <RefreshCw className="size-4" aria-hidden="true" />
        Actualizar
      </button>
    </div>
  );
}
