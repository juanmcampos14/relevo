import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { VMN_BASE, parseVmnArticle, parseVmnHome } from "@/domain/brief/sources";
import { fetchGoogleNews } from "@/server/news/google-news";
import { normalize } from "@/domain/news";

// Recolección determinista (sin IA): qué notas nuevas hay desde el último brief.
// Vaca Muerta News es la fuente prioritaria (se lee la nota completa); Google Noticias cubre medios
// regionales, oficiales y corporativos (título + medio). Las URLs ya vistas no vuelven a entrar.

export type CollectedItem = {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  priority: "vmn" | "regional";
  description: string | null;
  body: string | null;
};

const UA = "RELEVO-OS/1.0 (+https://relevo-juan-campos.vercel.app; morning brief)";
const MAX_VMN_ARTICLES = 18;
const MAX_REGIONAL = 25;
const REGIONAL_QUERIES = ["Añelo", '"Vaca Muerta"', "Neuquén petróleo obra", "Vaca Muerta contratista proveedores"];

async function get(url: string, ms = 12_000) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} respondió ${res.status}`);
  return res.text();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

export async function collectItems(
  db: SupabaseClient<Database>,
  workspaceId: string,
  period: { start: Date; end: Date },
): Promise<{ items: CollectedItem[]; errors: string[] }> {
  const errors: string[] = [];
  const { data: seenRows } = await db.from("brief_source_items").select("url").eq("workspace_id", workspaceId).gte("seen_at", new Date(Date.now() - 60 * 86_400_000).toISOString());
  const seen = new Set((seenRows ?? []).map((r) => r.url));
  const inPeriod = (iso: string | null) => !iso || (new Date(iso) >= new Date(period.start.getTime() - 6 * 3600_000) && new Date(iso) <= period.end);

  // 1) Vaca Muerta News: portada → notas no vistas → nota completa.
  const vmn: CollectedItem[] = [];
  try {
    const urls = parseVmnHome(await get(`${VMN_BASE}/`)).filter((u) => !seen.has(u)).slice(0, MAX_VMN_ARTICLES * 2);
    const parsed = await mapLimit(urls, 4, async (u) => {
      try {
        return parseVmnArticle(await get(u), u);
      } catch (e) {
        errors.push(`VMN ${u}: ${(e as Error).message}`);
        return null;
      }
    });
    for (const a of parsed) {
      if (!a || !inPeriod(a.publishedAt)) continue;
      vmn.push({ url: a.url, title: a.title, publisher: "Vaca Muerta News", publishedAt: a.publishedAt, priority: "vmn", description: a.description, body: a.body.slice(0, 6000) });
    }
  } catch (e) {
    errors.push(`Vaca Muerta News: ${(e as Error).message}`);
  }

  // 2) Medios regionales / oficiales / corporativos vía Google Noticias (título + medio).
  const regional: CollectedItem[] = [];
  const titles = new Set(vmn.map((v) => normalize(v.title)));
  for (const q of REGIONAL_QUERIES) {
    try {
      for (const n of await fetchGoogleNews(q, 2)) {
        if (seen.has(n.url) || !inPeriod(n.publishedAt)) continue;
        const t = normalize(n.title);
        if (titles.has(t)) continue;
        titles.add(t);
        regional.push({ url: n.url, title: n.title, publisher: n.sourceName ?? "—", publishedAt: n.publishedAt, priority: "regional", description: n.snippet, body: null });
      }
    } catch (e) {
      errors.push(`Google Noticias "${q}": ${(e as Error).message}`);
    }
  }
  const byDate = (a: CollectedItem, b: CollectedItem) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
  return { items: [...vmn.sort(byDate).slice(0, MAX_VMN_ARTICLES), ...regional.sort(byDate).slice(0, MAX_REGIONAL)], errors };
}
