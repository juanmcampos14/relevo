import "server-only";

import { XMLParser } from "fast-xml-parser";
import { cleanTitle, normalize, stripHtml, type NewsItem } from "@/domain/news";

// ADAPTER — Google Noticias (RSS de búsqueda). Gratis y sin clave; adecuado para uso interno.
// Para un SaaS comercial conviene un proveedor licenciado (p. ej. APITube, como en Jota):
// se agrega otro adapter con esta misma firma sin tocar el resto.
export const PROVIDER = "google_news_rss";
const TIMEOUT_MS = 12_000;

export function feedUrl(query: string, days: number) {
  const u = new URL("https://news.google.com/rss/search");
  u.searchParams.set("q", `${query} when:${days}d`);
  u.searchParams.set("hl", "es-419");
  u.searchParams.set("gl", "AR");
  u.searchParams.set("ceid", "AR:es-419");
  return u.toString();
}

type RawItem = {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  description?: string;
  source?: string | { "#text"?: string; "@_url"?: string };
};

/** Parseo PURO del RSS (testeable sin red). */
export function parseFeed(xml: string): NewsItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RawItem | RawItem[] } } };
  const raw = doc.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: NewsItem[] = [];
  for (const it of items) {
    const link = typeof it.link === "string" ? it.link.trim() : "";
    const title = typeof it.title === "string" ? it.title : "";
    if (!/^https?:\/\//.test(link) || !title) continue;
    const src = it.source;
    const sourceName = typeof src === "string" ? src : src?.["#text"] ?? null;
    const sourceUrl = typeof src === "object" ? src?.["@_url"] ?? null : null;
    const guid = typeof it.guid === "string" ? it.guid : it.guid?.["#text"];
    const cleaned = cleanTitle(title, sourceName);
    let snippet = it.description ? stripHtml(it.description) : null;
    // En Google Noticias la descripción suele repetir título + medio: no aporta.
    if (snippet && normalize(snippet).startsWith(normalize(cleaned).slice(0, 40))) snippet = null;
    const date = it.pubDate ? new Date(it.pubDate) : null;
    out.push({
      externalId: guid?.trim() || link,
      url: link,
      title: cleaned,
      sourceName,
      sourceUrl,
      snippet,
      publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    });
  }
  return out;
}

export async function fetchGoogleNews(query: string, days = 7): Promise<NewsItem[]> {
  const res = await fetch(feedUrl(query, days), {
    headers: { "user-agent": "RELEVO-OS/1.0 (+radar de noticias)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Noticias respondió ${res.status}`);
  return parseFeed(await res.text());
}
