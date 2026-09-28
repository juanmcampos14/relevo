// Enlaces oficiales de Google Maps (URLs universales, sin API key).
// https://developers.google.com/maps/documentation/urls/get-started
// Nunca afirmamos haber calculado una ruta: solo abrimos Google Maps con destino/paradas.

export type AddressStatus = "sin_direccion" | "no_verificada" | "verificada";

export type Place = {
  address_text: string | null;
  locality: string | null;
  province: string | null;
  country: string | null;
  address_status: AddressStatus | (string & {});
  latitude: number | null;
  longitude: number | null;
};

export type MapsLink =
  | { kind: "ok"; url: string; verified: boolean }
  | { kind: "none"; reason: string };

/** Límite práctico de paradas intermedias en la app móvil de Google Maps. */
export const MOBILE_MAX_WAYPOINTS = 3;

/** Texto de destino: coordenadas si hay ubicación verificada; si no, la dirección escrita. */
export function placeQuery(p: Place): string | null {
  if (p.address_status === "verificada" && p.latitude != null && p.longitude != null) {
    return `${p.latitude},${p.longitude}`;
  }
  if (p.address_status === "sin_direccion" || !p.address_text?.trim()) return null;
  return [p.address_text, p.locality, p.province, p.country]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
}

export function searchLink(p: Place): MapsLink {
  const q = placeQuery(p);
  if (!q) return { kind: "none", reason: "Sin dirección registrada" };
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", q);
  return { kind: "ok", url: url.toString(), verified: p.address_status === "verificada" };
}

export function directionsLink(p: Place): MapsLink {
  const q = placeQuery(p);
  if (!q) return { kind: "none", reason: "Sin dirección registrada" };
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", q);
  url.searchParams.set("travelmode", "driving");
  return { kind: "ok", url: url.toString(), verified: p.address_status === "verificada" };
}

export type MultiStopLink =
  | { kind: "ok"; url: string; unverifiedCount: number; skipped: number }
  | { kind: "none"; reason: string };

/**
 * Ruta con varias paradas EN EL ORDEN MANUAL dado (no optimizada).
 * Las paradas sin dirección se omiten y se informan. Si hay más paradas de las
 * que admite el móvil, no se genera: la UI ofrece abrir destino por destino.
 */
export function multiStopLink(places: Place[]): MultiStopLink {
  const withQuery = places.map((p) => ({ p, q: placeQuery(p) })).filter((x) => x.q);
  const skipped = places.length - withQuery.length;
  if (withQuery.length < 2) return { kind: "none", reason: "Se necesitan al menos 2 paradas con dirección" };
  if (withQuery.length - 1 > MOBILE_MAX_WAYPOINTS) {
    return {
      kind: "none",
      reason: `Más de ${MOBILE_MAX_WAYPOINTS + 1} paradas: abrí cada destino por separado`,
    };
  }
  const destination = withQuery[withQuery.length - 1];
  const waypoints = withQuery.slice(0, -1);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destination.q!);
  url.searchParams.set("waypoints", waypoints.map((w) => w.q).join("|"));
  url.searchParams.set("travelmode", "driving");
  const unverifiedCount = withQuery.filter((x) => x.p.address_status !== "verificada").length;
  return { kind: "ok", url: url.toString(), unverifiedCount, skipped };
}
