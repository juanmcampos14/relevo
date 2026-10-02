import "server-only";

// Los enlaces de Google Noticias (news.google.com/rss/articles/…) no son la nota: son una redirección.
// Antes de guardar una fuente se resuelven a la URL original del medio, para que un clic lleve directo
// al artículo. Si no se puede resolver, se conserva el enlace de Google (que igual termina en la nota).

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const TIMEOUT_MS = 10_000;
const cache = new Map<string, string>();

export const isGoogleNewsUrl = (url: string | null | undefined) => !!url && /^https?:\/\/news\.google\.com\/(rss\/)?articles\//i.test(url);

/** Id de la nota en el enlace de Google Noticias. */
function articleId(url: string): string | null {
  try {
    return new URL(url).pathname.split("/").pop() || null;
  } catch {
    return null;
  }
}

/** Formato viejo: la URL viaja dentro del id en base64. */
function fromBase64(id: string): string | null {
  try {
    const s = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    const m = s.match(/https?:\/\/[^\s\x00-\x1f"]+/);
    return m && !m[0].includes("news.google.com") ? m[0] : null;
  } catch {
    return null;
  }
}

/** Formato actual: la página de la nota trae una firma con la que Google devuelve la URL original. */
async function fromGoogle(id: string): Promise<string | null> {
  const page = await fetch(`https://news.google.com/articles/${id}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!page.ok) return null;
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const payload = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]), null, "generic"]]];
  const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA },
    body: `f.req=${encodeURIComponent(JSON.stringify(payload))}`,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const m = (await res.text()).match(/\\"garturlres\\",\\"(https?:[^"\\]+)\\"/);
  return m?.[1] ?? null;
}

/** URL original de una fuente (si es de Google Noticias, la del medio; si no, la misma). */
export async function originalUrl(url: string): Promise<string> {
  if (!isGoogleNewsUrl(url)) return url;
  const hit = cache.get(url);
  if (hit) return hit;
  const id = articleId(url);
  const resolved = id ? fromBase64(id) ?? (await fromGoogle(id).catch(() => null)) : null;
  const out = resolved && /^https?:\/\//i.test(resolved) ? resolved : url;
  cache.set(url, out);
  return out;
}
