// ¿El lugar que devolvió un buscador de mapas es el que buscamos? Puro y testeable. Sin inventar precisión:
// solo cuentan las palabras distintivas del nombre (las genéricas como "viandas", "complejo" o "suites" no
// alcanzan), el resultado tiene que estar donde decimos que está, y un barrio o una calle no es un lugar.

import { fold } from "@/domain/crm-import/map";

const GENERIC = new Set([
  "anelo", "neuquen", "vaca", "muerta", "hotel", "hoteles", "suites", "apart", "aparts", "housing", "complejo", "habitacional",
  "departamentos", "departamento", "deptos", "viandas", "vianda", "empresariales", "catering", "lavadero", "lavanderia", "laundry",
  "industrial", "industriales", "servicios", "servicio", "grupo", "group", "base", "transporte", "transportes", "storage",
  "facility", "nuevo", "nueva", "sucursal", "sede", "productos", "limpieza", "empresa", "empresas", "rental", "truck", "center",
  "obra", "local", "casas", "casa", "ruta", "parque", "soluciones", "medicina",
]);
/** Tipos de Google que describen una zona y no un lugar puntual. */
const AREA_TYPES = new Set(["neighborhood", "sublocality", "sublocality_level_1", "locality", "political", "route", "administrative_area_level_1", "administrative_area_level_2", "postal_code", "plus_code", "colloquial_area"]);

export const distinctive = (s: string) => new Set(fold(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !GENERIC.has(w) && !/^\d+$/.test(w)));

/**
 * Comparten todas las palabras distintivas del nombre buscado (o, si son 3 o más, al menos dos tercios).
 * "FERRELEC / Genelec" son alias: alcanza con que coincida uno.
 */
export function sameDistinctiveName(wanted: string, found: string): boolean {
  const aliases = wanted.split(/\s*\/\s*/).filter(Boolean);
  if (aliases.length > 1) return aliases.some((a) => sameDistinctiveName(a, found));
  const a = distinctive(wanted);
  if (!a.size) return false;
  const b = distinctive(found);
  const shared = [...a].filter((w) => b.has(w)).length;
  return a.size >= 3 ? shared / a.size >= 2 / 3 : shared === a.size;
}

const R = 6_371_000;
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const ANELO_POINT = { lat: -38.3542, lng: -68.7877 };

/**
 * Clasifica un resultado de Google Places para un registro: "aproximada" (es ese lugar), "inferida" (es la
 * zona: un barrio o una calle con ese nombre) o null (no es el lugar). Si el registro es de Añelo, el
 * resultado tiene que estar a 30 km; si no, a 200 km (Vaca Muerta y Neuquén capital).
 */
export function classifyPlace(wanted: { name: string; locality: string | null }, place: { name: string; lat: number; lng: number; types: string[] }): "aproximada" | "inferida" | null {
  if (!sameDistinctiveName(wanted.name, place.name)) return null;
  const inAnelo = !wanted.locality || /a[nñ]elo/i.test(wanted.locality);
  const maxM = inAnelo ? 30_000 : 200_000;
  if (distanceM(ANELO_POINT, { lat: place.lat, lng: place.lng }) > maxM) return null;
  return place.types.some((t) => AREA_TYPES.has(t)) ? "inferida" : "aproximada";
}
