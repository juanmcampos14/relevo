"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LocateFixed } from "lucide-react";

/** Centrar el mapa donde estoy (GPS del teléfono). */
export function UseMyLocation() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!navigator.geolocation) return;
        setBusy(true);
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const q = new URLSearchParams(params.toString());
            q.set("lat", p.coords.latitude.toFixed(6));
            q.set("lng", p.coords.longitude.toFixed(6));
            q.set("aqui", "1");
            router.push(`?${q}`);
            setBusy(false);
          },
          () => setBusy(false),
          { enableHighAccuracy: true, timeout: 10_000 },
        );
      }}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-50"
    >
      <LocateFixed className="size-4" aria-hidden="true" />
      {busy ? "Ubicando…" : "Donde estoy"}
    </button>
  );
}
