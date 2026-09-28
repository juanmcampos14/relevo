"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Mientras el servidor actualiza las noticias en segundo plano, vuelve a pedir la página
 * (router.refresh ignora la versión precargada del cliente). Dos intentos, luego se detiene.
 */
export function NewsAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timers = [6_000, 15_000].map((ms) => setTimeout(() => router.refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active, router]);
  return null;
}
