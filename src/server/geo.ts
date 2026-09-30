import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { PLACE_CATEGORIES, bbox, distanceM, type PlaceCategory, type Point } from "@/domain/geo";
import { companyName } from "@/server/entities";

// Inteligencia territorial: OpenStreetMap (Overpass para lugares, Nominatim para ubicar) + la memoria
// propia de RELEVO con coordenadas. OSM es una fuente pública con cobertura incompleta en pueblos chicos:
// todo lo que devuelve dice de dónde sale para no confundirlo con la oferta real.

type Db = SupabaseClient<Database>;
const UA = "RELEVO-OS/1.0 (+https://relevo-juan-campos.vercel.app)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

// Google Places (API nueva): mejor cobertura de comercios chicos, con horarios, reseñas y teléfono.
// Se usa si hay GOOGLE_MAPS_API_KEY; si no, OpenStreetMap.
const GOOGLE_QUERY: Record<PlaceCategory, string> = {
  ferreteria: "ferretería", corralon: "corralón materiales de construcción", electricidad: "casa de electricidad", sanitarios: "sanitarios",
  seguridad_industrial: "seguridad industrial ropa de trabajo", alojamiento: "hotel alojamiento", gastronomia: "restaurante comida", gimnasio: "gimnasio",
  lavadero: "lavadero de autos", combustible: "estación de servicio", supermercado: "supermercado almacén", taller: "taller mecánico", industria: "galpón depósito industrial",
};

export type Place = { name: string; category: string; lat: number; lng: number; distance_m: number; address: string | null; hours: string | null; phone: string | null; website: string | null; osm: string; rating?: number; reviews?: number };

export async function placesNearby(center: Point, radiusM: number, category: PlaceCategory | null, nameLike?: string): Promise<{ places: Place[]; source: string; error?: string }> {
  const r = Math.min(Math.max(radiusM, 100), 25_000);
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key && (category || nameLike)) {
    const g = await googlePlaces(key, center, r, category ? GOOGLE_QUERY[category] : nameLike!);
    if (!g.error) return g;
  }
  return osmPlaces(center, r, category, nameLike);
}

async function googlePlaces(key: string, center: Point, r: number, textQuery: string): Promise<{ places: Place[]; source: string; error?: string }> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.regularOpeningHours.weekdayDescriptions,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri",
      },
      body: JSON.stringify({ textQuery, languageCode: "es", regionCode: "AR", maxResultCount: 20, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(r, 50_000) } } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { places: [], source: "Google Places", error: `Google Places respondió ${res.status}` };
    const json = (await res.json()) as { places?: { displayName?: { text: string }; location: { latitude: number; longitude: number }; formattedAddress?: string; primaryTypeDisplayName?: { text: string }; rating?: number; userRatingCount?: number; regularOpeningHours?: { weekdayDescriptions?: string[] }; websiteUri?: string; nationalPhoneNumber?: string; googleMapsUri?: string }[] };
    const places = (json.places ?? [])
      .map((p): Place => ({
        name: p.displayName?.text ?? "(sin nombre)",
        category: p.primaryTypeDisplayName?.text ?? textQuery,
        lat: p.location.latitude,
        lng: p.location.longitude,
        distance_m: distanceM(center, { lat: p.location.latitude, lng: p.location.longitude }),
        address: p.formattedAddress ?? null,
        hours: p.regularOpeningHours?.weekdayDescriptions?.join(" · ") ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        osm: p.googleMapsUri ?? "",
        ...(p.rating ? { rating: p.rating, reviews: p.userRatingCount ?? 0 } : {}),
      }))
      .filter((p) => p.distance_m <= r)
      .sort((a, b) => a.distance_m - b.distance_m);
    return { places, source: "Google Places (listados públicos de Google Maps; puede faltar lo que no está cargado)" };
  } catch {
    return { places: [], source: "Google Places", error: "No se pudo consultar Google Places." };
  }
}

async function osmPlaces(center: Point, r: number, category: PlaceCategory | null, nameLike?: string): Promise<{ places: Place[]; source: string; error?: string }> {
  const around = `(around:${r},${center.lat},${center.lng})`;
  const filters = category
    ? PLACE_CATEGORIES[category].osm.map(([k, v]) => `nwr["${k}"="${v}"]${around};`).join("")
    : nameLike
      ? `nwr["name"~"${nameLike.replace(/["\\]/g, "")}",i]${around};`
      : `nwr["shop"]${around};nwr["amenity"~"restaurant|fast_food|cafe|fuel|car_wash"]${around};nwr["tourism"~"hotel|motel|guest_house|hostel"]${around};`;
  const query = `[out:json][timeout:20];(${filters});out center tags 200;`;
  for (const endpoint of OVERPASS) {
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    if (!res.ok || !text.startsWith("{")) continue;
    const json = JSON.parse(text) as { elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };
    const places = json.elements
      .map((e): Place | null => {
        const lat = e.lat ?? e.center?.lat;
        const lng = e.lon ?? e.center?.lon;
        if (lat == null || lng == null) return null;
        const t = e.tags ?? {};
        return {
          name: t.name ?? t.brand ?? "(sin nombre en el mapa)",
          category: t.shop ?? t.amenity ?? t.tourism ?? t.leisure ?? t.craft ?? t.landuse ?? t.building ?? "lugar",
          lat, lng,
          distance_m: distanceM(center, { lat, lng }),
          address: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || null,
          hours: t.opening_hours ?? null,
          phone: t.phone ?? t["contact:phone"] ?? null,
          website: t.website ?? t["contact:website"] ?? null,
          osm: `https://www.openstreetmap.org/${e.type}/${e.id}`,
        };
      })
      .filter((p): p is Place => !!p)
      .sort((a, b) => a.distance_m - b.distance_m);
    return { places, source: "OpenStreetMap (mapa colaborativo; en localidades chicas faltan muchos comercios: cero resultados no significa cero oferta)" };
  } catch {
    continue;
  }
  }
  return { places: [], source: "OpenStreetMap", error: "No se pudo consultar OpenStreetMap (los servidores públicos no respondieron)." };
}

/** Ubica un lugar por nombre ("Añelo", "Ruta 7 y 17, Añelo"). */
export async function geocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
  } catch {
    return null;
  }
}

export type MemoryPoint = { ref: string; kind: "asset" | "establishment" | "capture"; name: string; lat: number; lng: number; distance_m: number; detail: string | null; href: string };

/** Lo que RELEVO ya tiene con coordenadas dentro de un radio: activos, establecimientos (empresas) y capturas. */
export async function memoryNearby(db: Db, slug: string, center: Point, radiusM: number): Promise<MemoryPoint[]> {
  const b = bbox(center, radiusM);
  const base = `/w/${slug}`;
  const within = <T extends { latitude: number | null; longitude: number | null }>(rows: T[] | null) =>
    (rows ?? []).filter((r) => r.latitude != null && r.longitude != null).map((r) => ({ r, d: distanceM(center, { lat: r.latitude!, lng: r.longitude! }) })).filter((x) => x.d <= radiusM);
  const [assets, ests, caps] = await Promise.all([
    db.from("assets").select("id, title, kind, operation, price_amount, price_currency, surface_m2, latitude, longitude").gte("latitude", b.minLat).lte("latitude", b.maxLat).gte("longitude", b.minLng).lte("longitude", b.maxLng).limit(300),
    db.from("establishments").select("id, name, address_text, latitude, longitude, companies(trade_name, legal_name)").gte("latitude", b.minLat).lte("latitude", b.maxLat).gte("longitude", b.minLng).lte("longitude", b.maxLng).limit(300),
    db.from("captures").select("id, captured_at, ai_summary, body, latitude, longitude").gte("latitude", b.minLat).lte("latitude", b.maxLat).gte("longitude", b.minLng).lte("longitude", b.maxLng).order("captured_at", { ascending: false }).limit(300),
  ]);
  return [
    ...within(assets.data).map(({ r, d }) => ({ ref: `asset:${r.id}`, kind: "asset" as const, name: r.title, lat: r.latitude!, lng: r.longitude!, distance_m: d, detail: [r.kind, r.operation !== "desconocida" ? r.operation : null, r.surface_m2 ? `${r.surface_m2} m²` : null, r.price_amount ? `${r.price_currency} ${r.price_amount.toLocaleString("es-AR")}` : null].filter(Boolean).join(" · "), href: `${base}/e/asset/${r.id}` })),
    ...within(ests.data).map(({ r, d }) => ({ ref: `establishment:${r.id}`, kind: "establishment" as const, name: r.companies ? companyName(r.companies) : r.name, lat: r.latitude!, lng: r.longitude!, distance_m: d, detail: r.address_text, href: `${base}/e/establishment/${r.id}` })),
    ...within(caps.data).map(({ r, d }) => ({ ref: `capture:${r.id}`, kind: "capture" as const, name: `Captura del ${new Date(r.captured_at).toLocaleDateString("es-AR")}`, lat: r.latitude!, lng: r.longitude!, distance_m: d, detail: (r.ai_summary ?? r.body ?? "").slice(0, 140) || null, href: `${base}/capturas/${r.id}` })),
  ].sort((a, b) => a.distance_m - b.distance_m);
}
