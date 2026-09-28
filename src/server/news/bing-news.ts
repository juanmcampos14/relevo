import "server-only";

import { XMLParser } from "fast-xml-parser";
import { stripHtml, type NewsItem } from "@/domain/news";

// ADAPTER — Bing Noticias (RSS). Sin clave. Trae URL ORIGINAL de la nota (en el parámetro
// `url` del enlace de seguimiento), resumen real y miniatura. Uso interno; para un SaaS
// comercial, un proveedor licenciado se agrega con la misma firma.
export const PROVIDER = "bing_news_rss";
const TIMEOUT_MS = 12_000;

export function feedUrl(query: string, first: number) {
  const u = new URL("https://www.bing.com/news/search");
  u.searchParams.set("q", query);
  u.searchParams.set("format", "rss");
  u.searchParams.set("setlang", "es");
  u.searchParams.set("cc", "AR");
  u.searchParams.set("mkt", "es-AR");
  u.searchParams.set("qft", 'sortbydate="1"');
  u.searchParams.set("first", String(first));
  return u.toString();
}

/** URL real de la nota a partir del enlace de seguimiento de Bing. */
export function originalUrl(link: string) {
  try {
    const u = new URL(link);
    const target = u.searchParams.get("url");
    return target && /^https?:\/\//i.test(target) ? target : link;
  } catch {
    return null;
  }
}

/** Miniatura HTTPS con tamaño fijo (16:9) para no mover el layout. */
export function thumbnail(raw: unknown) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim().replace(/^http:\/\//i, "https://"));
    if (!/(^|\.)bing\.(com|net)$/.test(u.hostname)) return null;
    u.searchParams.set("w", "400");
    u.searchParams.set("h", "225");
    u.searchParams.set("c", "14");
    return u.toString();
  } catch {
    return null;
  }
}

type RawItem = {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  "News:Source"?: string;
  "News:Image"?: string;
};

/** Parseo PURO del RSS (testeable sin red). */
export function parseBingFeed(xml: string): NewsItem[] {
  const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RawItem | RawItem[] } } };
  const raw = doc.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: NewsItem[] = [];
  for (const it of items) {
    const title = typeof it.title === "string" ? stripHtml(it.title) : "";
    const url = typeof it.link === "string" ? originalUrl(it.link.trim()) : null;
    if (!title || !url) continue;
    const date = it.pubDate ? new Date(it.pubDate) : null;
    const snippet = typeof it.description === "string" ? stripHtml(it.description) : null;
    out.push({
      externalId: url,
      url,
      title,
      sourceName: typeof it["News:Source"] === "string" ? it["News:Source"] : null,
      sourceUrl: (() => {
        try {
          return new URL(url).origin;
        } catch {
          return null;
        }
      })(),
      snippet: snippet || null,
      publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      imageUrl: thumbnail(it["News:Image"]),
    });
  }
  return out;
}

/** Tres páginas ordenadas por fecha (~30 notas), deduplicadas por URL. */
export async function fetchBingNews(query: string, pages = 3): Promise<NewsItem[]> {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (let p = 0; p < pages; p++) {
    const res = await fetch(feedUrl(query, 1 + p * 10), {
      headers: { "user-agent": "Mozilla/5.0 (compatible; RELEVO-OS/1.0; radar de noticias)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Bing Noticias respondió ${res.status}`);
    const batch = parseBingFeed(await res.text());
    for (const i of batch) {
      if (seen.has(i.url)) continue;
      seen.add(i.url);
      out.push(i);
    }
    if (batch.length < 8) break;
  }
  return out;
}
