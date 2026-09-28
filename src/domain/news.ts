// Radar de noticias: modelo neutral al proveedor (mismo criterio que el NewsPort de Jota).
// Un tema es una búsqueda + un filtro ESTRICTO: la nota tiene que nombrar el término.

export type NewsItem = {
  externalId: string;
  url: string;
  title: string;
  sourceName: string | null;
  sourceUrl: string | null;
  snippet: string | null;
  publishedAt: string | null;
};

export type NewsTopic = { key: string; label: string; query: string; mustMention: string[] };

export const TOPICS: Record<string, NewsTopic> = {
  vaca_muerta: { key: "vaca_muerta", label: "Vaca Muerta", query: '"Vaca Muerta"', mustMention: ["vaca muerta"] },
  anelo: { key: "anelo", label: "Añelo", query: "Añelo", mustMention: ["añelo"] },
};

/** Temas del radar del workspace (orden = prioridad de actualización). */
export const RADAR_TOPICS = ["vaca_muerta", "anelo"] as const;

/** Temas que nombra la nota (una nota puede ser de Vaca Muerta y de Añelo a la vez). */
export function topicsOf(item: Pick<NewsItem, "title" | "snippet">) {
  return RADAR_TOPICS.filter((k) => mentions(item, TOPICS[k].mustMention));
}

export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * true si el título o el resumen nombran alguno de los términos como PALABRA completa
 * (sin tildes, "añelo" es "anelo" y no debe coincidir dentro de "canelones").
 */
export function mentions(item: Pick<NewsItem, "title" | "snippet">, terms: string[]) {
  const text = normalize(`${item.title} ${item.snippet ?? ""}`);
  return terms.some((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(normalize(t))}($|[^\\p{L}\\p{N}])`, "u").test(text));
}

export function stripHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Título de la nota - Medio" → "Título de la nota" cuando el sufijo es el medio. */
export function cleanTitle(title: string, source: string | null) {
  const t = title.trim();
  if (source && t.endsWith(` - ${source}`)) return t.slice(0, -(source.length + 3)).trim();
  return t;
}
