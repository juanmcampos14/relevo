// Lectura PURA de Vaca Muerta News (sin RSS): portada → URLs de notas; nota → título, fecha y cuerpo.
// Testeable sin red; si el sitio cambia su HTML, falla un test y no el brief completo.

export const VMN_BASE = "https://www.vacamuertanews.com";

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export const stripTags = (html: string) =>
  decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** URLs absolutas de notas (.htm) de la portada, sin duplicados ni ediciones de radio. */
export function parseVmnHome(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\.htm)"/gi)) {
    const path = m[1];
    if (/vaca-muerta-news-radio/i.test(path)) continue;
    out.add(`${VMN_BASE}${path}`);
  }
  return [...out];
}

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, "i"))?.[1] ??
  null;

export type ParsedArticle = { url: string; title: string; description: string | null; publishedAt: string | null; body: string };

export function parseVmnArticle(html: string, url: string): ParsedArticle | null {
  const title = meta(html, "og:title") ?? html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? null;
  if (!title) return null;
  const published = meta(html, "article:published_time");
  const date = published ? new Date(published) : null;
  const start = html.search(/class="[^"]*bloque-cuerpo[^"]*"/i);
  const endRel = start >= 0 ? html.slice(start).search(/class="[^"]*(etiquetas-nota|etiquetas-interior|notas-bottom)[^"]*"/i) : -1;
  const region = start >= 0 ? html.slice(start, endRel > 0 ? start + endRel : start + 60_000) : "";
  const paragraphs = [...region.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => stripTags(p[1])).filter((t) => t.length > 1);
  return {
    url,
    title: decode(title).trim(),
    description: meta(html, "og:description") ? decode(meta(html, "og:description")!).trim() : null,
    publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    body: paragraphs.join("\n"),
  };
}
