import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { memoryNearby, placesNearby } from "@/server/geo";
import { ANELO, PLACE_CATEGORIES, PLACE_CATEGORY_KEYS, formatDistance, type PlaceCategory } from "@/domain/geo";
import { PageHeader, Section } from "@/components/app/bits";
import { LAYER_COLOR, TerritoryMap, type MapPoint } from "@/components/map/territory-map";
import { UseMyLocation } from "@/components/map/use-my-location";

export const metadata: Metadata = { title: "Mapa" };

const RADII = [500, 1000, 5000, 10_000];
const LAYER_LABEL = { asset: "Activos", establishment: "Empresas", capture: "Capturas", place: "Lugares reales", here: "Vos" } as const;

// El territorio con nuestra memoria encima: activos, empresas y capturas; y, si se pide, lugares reales
// de una categoría (fuente pública, con sus límites).
export default async function MapPage({ params, searchParams }: PageProps<"/w/[slug]/mapa">) {
  const { slug } = await params;
  const sp = await searchParams;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const lat = Number(sp.lat);
  const lng = Number(sp.lng);
  const center = Number.isFinite(lat) && Number.isFinite(lng) && sp.lat ? { lat, lng } : ANELO;
  const radius = RADII.includes(Number(sp.r)) ? Number(sp.r) : Math.min(Math.max(Number(sp.r) || 5000, 100), 25_000);
  const cat = PLACE_CATEGORY_KEYS.find((k) => k === sp.cat) as PlaceCategory | undefined;
  const [memory, places] = await Promise.all([memoryNearby(supabase, slug, center, radius), cat ? placesNearby(center, radius, cat) : Promise.resolve(null)]);
  const points: MapPoint[] = [
    ...memory.map((m) => ({ lat: m.lat, lng: m.lng, label: m.name, detail: m.detail, href: m.href, layer: m.kind })),
    ...(places?.places ?? []).map((p) => ({ lat: p.lat, lng: p.lng, label: p.name, detail: [p.category, p.address, formatDistance(p.distance_m)].filter(Boolean).join(" · "), href: p.osm || null, layer: "place" as const })),
    ...(sp.aqui ? [{ lat: center.lat, lng: center.lng, label: "Vos estás acá", layer: "here" as const }] : []),
  ];
  const qs = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams({ lat: String(center.lat), lng: String(center.lng), r: String(radius), ...(cat ? { cat } : {}), ...(sp.aqui ? { aqui: "1" } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `?${q}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Mapa" subtitle={`${sp.lat ? (sp.aqui ? "Donde estás" : "Punto elegido") : "Centro de Añelo"} · radio ${formatDistance(radius)}. Pedile a RELEVO que mire el territorio: "¿qué competidores hay en 5 km?"`} />
      <div className="flex flex-wrap items-center gap-2">
        <Suspense fallback={null}><UseMyLocation /></Suspense>
        {RADII.map((r) => <Link key={r} href={qs({ r: String(r) })} className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${r === radius ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>{formatDistance(r)}</Link>)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Link href={qs({ cat: null })} className={`inline-flex h-8 items-center rounded-full border px-3 text-xs ${!cat ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>Solo nuestra memoria</Link>
        {PLACE_CATEGORY_KEYS.map((k) => <Link key={k} href={qs({ cat: k })} className={`inline-flex h-8 items-center rounded-full border px-3 text-xs ${cat === k ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>{PLACE_CATEGORIES[k].label}</Link>)}
      </div>
      <TerritoryMap center={center} radiusM={radius} points={points} />
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(LAYER_LABEL) as (keyof typeof LAYER_LABEL)[]).map((l) => <span key={l} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: LAYER_COLOR[l] }} />{LAYER_LABEL[l]}</span>)}
      </p>
      {places && (
        <Section title={`${PLACE_CATEGORIES[cat!].label} en ${formatDistance(radius)} (${places.places.length})`}>
          <p className="text-xs text-muted-foreground">Fuente: {places.source}{places.error ? ` · ${places.error}` : ""}</p>
          {places.places.length ? (
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {places.places.slice(0, 40).map((p, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                  <span><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">· {p.category}{p.address ? ` · ${p.address}` : ""}</span></span>
                  <span className="text-xs text-muted-foreground">{formatDistance(p.distance_m)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">La fuente no devolvió lugares: eso no significa que no existan. Complementá con RELEVO (búsqueda web) o en campo.</p>
          )}
        </Section>
      )}
      <Section title={`Nuestra memoria en ${formatDistance(radius)} (${memory.length})`}>
        {memory.length ? (
          <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
            {memory.slice(0, 60).map((m) => (
              <li key={m.ref}><Link href={m.href} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 hover:bg-muted/50"><span><span className="font-medium">{m.name}</span>{m.detail ? <span className="text-muted-foreground"> · {m.detail}</span> : null}</span><span className="text-xs text-muted-foreground">{formatDistance(m.distance_m)}</span></Link></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nada georreferenciado en este radio todavía. Las capturas con GPS, los activos y las direcciones verificadas aparecen acá.</p>
        )}
      </Section>
    </div>
  );
}
