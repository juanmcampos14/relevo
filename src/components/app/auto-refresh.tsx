"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Mientras algo se procesa en el servidor, refresca la página cada `everyMs` (sin recargar). */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
