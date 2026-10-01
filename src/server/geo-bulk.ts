import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fold } from "@/domain/crm-import/map";

// Ubicación en lote de establecimientos y activos, sin inventar precisión. Niveles (location_status):
//   verified     = confirmada (solo una persona o el GPS en el lugar; este lote NUNCA la asigna)
//   approximate  = aproximada (el lugar o la dirección exacta aparecen en el mapa)
//   unverified   = inferida (solo la ruta, el barrio o un nombre parecido: sabemos la zona, no el punto)
//   null         = sin ubicación
// Fuente: OpenStreetMap (Nominatim), a 1 consulta por segundo como pide su política de uso.

type Db = SupabaseClient<Database>;
const UA = "RELEVO-OS/1.0 (hola@relevo.site)";
// Añelo y alrededores (Vaca Muerta norte): oeste, norte, este, sur.
const VIEWBOX = "-69.40,-37.90,-68.20,-38.80";
const POI = new Set(["tourism", "amenity", "shop", "office", "craft", "building", "industrial", "landuse", "man_made"]);

type Hit = { lat: string; lon: string; display_name: string; class: string; type: string; name?: string; addresstype?: string };
export type GeoResult = { kind: "establishment" | "asset"; id: string; name: string; query: string; level: "aproximada" | "inferida" | "sin_ubicacion"; lat?: number; lng?: number; accuracy_m?: number; matched?: string; source?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function nominatim(q: string): Promise<Hit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ar&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es" }, signal: AbortSignal.timeout(15_000) });
  await sleep(1100);
  return res.ok ? ((await res.json()) as Hit[]) : [];
}

/** ¿El resultado es ese lugar? Comparte palabras significativas del nombre. */
function sameName(name: string, hit: Hit): boolean {
  const words = (s: string) => new Set(fold(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !["hotel", "anelo", "neuquen", "grupo", "servicios"].includes(w)));
  const a = words(name);
  const b = words(hit.name ?? hit.display_name.split(",")[0]);
  return [...a].some((w) => b.has(w));
}

export async function locate(name: string, address: string | null, locality: string | null): Promise<Omit<GeoResult, "kind" | "id" | "name">> {
  const place = locality && !/vaca muerta/i.test(locality) ? locality : "Añelo";
  // 1. El lugar por su nombre (un hotel, un comercio): aproximada si el mapa lo tiene con ese nombre.
  const byName = await nominatim(`${name}, ${place}, Neuquén`);
  const poi = byName.find((h) => POI.has(h.class) && sameName(name, h));
  if (poi) return { query: `${name}, ${place}`, level: "aproximada", lat: Number(poi.lat), lng: Number(poi.lon), accuracy_m: 150, matched: poi.display_name, source: "osm:nominatim:nombre" };
  if (address) {
    // 2. La dirección: con número o edificio, aproximada; solo la ruta o la calle, inferida.
    const byAddr = await nominatim(`${address}, ${place}, Neuquén`);
    const exact = byAddr.find((h) => ["house", "building"].includes(h.addresstype ?? h.type));
    if (exact) return { query: `${address}, ${place}`, level: "aproximada", lat: Number(exact.lat), lng: Number(exact.lon), accuracy_m: 100, matched: exact.display_name, source: "osm:nominatim:direccion" };
    const road = byAddr.find((h) => h.class === "highway" || ["road", "suburb", "neighbourhood", "quarter"].includes(h.addresstype ?? ""));
    if (road) return { query: `${address}, ${place}`, level: "inferida", lat: Number(road.lat), lng: Number(road.lon), accuracy_m: 3000, matched: road.display_name, source: "osm:nominatim:zona" };
  }
  return { query: `${name}${address ? ` · ${address}` : ""}, ${place}`, level: "sin_ubicacion" };
}

const STATUS = { aproximada: "approximate", inferida: "unverified" } as const;

/** Ubica lo que todavía no tiene coordenadas. dryRun: solo informa. Nunca pisa una ubicación existente. */
export async function geocodeAll(db: Db, opts: { dryRun: boolean }): Promise<GeoResult[]> {
  const [{ data: ests }, { data: assets }] = await Promise.all([
    db.from("establishments").select("id, name, address_text, locality").is("latitude", null).eq("is_demo", false),
    db.from("assets").select("id, title, address_text, locality").is("latitude", null).eq("is_demo", false),
  ]);
  const out: GeoResult[] = [];
  const items = [
    ...(ests ?? []).map((e) => ({ kind: "establishment" as const, id: e.id, name: e.name, address: e.address_text, locality: e.locality })),
    ...(assets ?? []).map((a) => ({ kind: "asset" as const, id: a.id, name: a.title.split("·")[0].trim(), address: a.address_text, locality: a.locality })),
  ];
  for (const it of items) {
    const r = { kind: it.kind, id: it.id, name: it.name, ...(await locate(it.name, it.address, it.locality)) };
    out.push(r);
    if (opts.dryRun || r.level === "sin_ubicacion") continue;
    const table = it.kind === "asset" ? "assets" : "establishments";
    await db.from(table).update({ latitude: r.lat!, longitude: r.lng!, location_status: STATUS[r.level], location_accuracy_m: r.accuracy_m!, location_source: `${r.source} · ${r.matched}`.slice(0, 300) }).eq("id", it.id).is("latitude", null);
  }
  return out;
}
