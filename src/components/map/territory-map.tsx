"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = { lat: number; lng: number; label: string; detail?: string | null; href?: string | null; layer: "asset" | "establishment" | "capture" | "place" | "here" };

const COLOR: Record<MapPoint["layer"], string> = { asset: "#7c3aed", establishment: "#0284c7", capture: "#059669", place: "#ea580c", here: "#dc2626" };

/** Mapa del territorio: nuestra memoria + lugares reales + radio. Leaflet con teselas de OpenStreetMap. */
export function TerritoryMap({ center, radiusM, points }: { center: { lat: number; lng: number }; radiusM: number; points: MapPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([center.lat, center.lng], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      const circle = L.circle([center.lat, center.lng], { radius: radiusM, color: "#64748b", weight: 1, fillOpacity: 0.04 }).addTo(map);
      for (const p of points) {
        const m = L.circleMarker([p.lat, p.lng], { radius: p.layer === "here" ? 8 : 6, color: "#fff", weight: 2, fillColor: COLOR[p.layer], fillOpacity: 0.95 }).addTo(map);
        const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
        m.bindPopup(`<strong>${esc(p.label)}</strong>${p.detail ? `<br/>${esc(p.detail)}` : ""}${p.href ? `<br/><a href="${esc(p.href)}">Abrir</a>` : ""}`);
      }
      map.fitBounds(circle.getBounds(), { padding: [12, 12] });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [center.lat, center.lng, radiusM, points]);
  return <div ref={ref} className="h-[55vh] min-h-80 w-full overflow-hidden rounded-xl border" role="region" aria-label="Mapa" />;
}

export const LAYER_COLOR = COLOR;
