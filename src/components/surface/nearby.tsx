"use client";

import { useCallback, useEffect, useState } from "react";
import { nearby } from "@/app/hoy/[slug]/actions";
import type { LookItem } from "@/server/surface";
import { LookCard, askHref, card } from "./cards";

// Cerca tuyo: lo que el Brain ya conoce alrededor de donde está la persona. Si no hay nada, RELEVO ofrece mirar.

export function Nearby({ slug, base }: { slug: string; base: string }) {
  const [state, setState] = useState<"sin_permiso" | "buscando" | "listo">("sin_permiso");
  const [items, setItems] = useState<LookItem[]>([]);

  const go = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setState("buscando");
    navigator.geolocation.getCurrentPosition(
      async (g) => { setItems(await nearby(slug, { lat: g.coords.latitude, lng: g.coords.longitude })); setState("listo"); },
      () => setState("sin_permiso"),
      { enableHighAccuracy: true, maximumAge: 120_000, timeout: 10_000 },
    );
  }, [slug]);

  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => { if (p.state === "granted") go(); }).catch(() => {});
  }, [go]);

  if (state === "sin_permiso")
    return (
      <div className={card}>
        <p className="text-[17px] font-medium">¿Qué hay cerca tuyo?</p>
        <p className="mt-1 text-[15px] text-[#6F6A60]">Con tu ubicación te digo qué conozco alrededor y qué miraría.</p>
        <button type="button" onClick={go} className="mt-3 rounded-full bg-[#1C1B19] px-4 py-2 text-[14px] font-medium text-white">Usar mi ubicación</button>
      </div>
    );
  if (state === "buscando") return <p className="px-1 text-[15px] text-[#8A8478]">Mirando alrededor…</p>;
  if (!items.length)
    return (
      <ul>
        <LookCard kicker="Cerca tuyo" title="Acá todavía no conozco nada." line="Puedo mirar qué hay alrededor: comercios, locales, movimiento." href={askHref(base, "¿Qué hay para mirar acá cerca? Mirá comercios, locales disponibles y movimiento alrededor de donde estoy.")} cta="Mirá vos" />
      </ul>
    );
  return <ul className="space-y-3">{items.map((it) => <LookCard key={it.id} kicker={it.kicker} title={it.title} line={it.line} href={askHref(base, it.ask)} />)}</ul>;
}
