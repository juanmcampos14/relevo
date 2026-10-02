// Trazabilidad: si RELEVO usó una fuente o conoce un lugar, la persona llega en un clic.

/** Link a Google Maps: por coordenadas si las hay; si no, por dirección (o nombre) y localidad. */
export function mapsUrl(o: { lat?: number | null; lng?: number | null; address?: string | null; name?: string | null; locality?: string | null }): string | null {
  if (o.lat != null && o.lng != null) return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  const q = [o.address || o.name, o.locality].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** "linkedin.com", "zonaprop.com.ar": cómo se nombra una fuente en una línea. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
