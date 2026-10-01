// ¿Es el mismo hecho? Una fuente nueva sobre un hecho ya conocido NO es una señal nueva: confirma o
// actualiza la historia existente. Se compara por cifras del hecho, entidades y palabras clave
// dentro de una ventana de días — nunca solo por URL.

const STOP = new Set(["para", "sobre", "desde", "hasta", "entre", "como", "esta", "este", "estos", "estas", "tiene", "tienen", "segun", "anelo", "vaca", "muerta", "neuquen", "millones", "nuevo", "nueva", "hecho", "publicado"]);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Cifras significativas normalizadas: "US$ 13.800 M" → "13800", "1.040 m²" → "1040". */
export function figures(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d.,]*/g)) {
    const raw = m[0].replace(/[.,]+$/, "");
    const n = raw.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
    const v = Number(n);
    if (Number.isFinite(v) && (v >= 100 || /[.,]/.test(raw)) && !(v >= 1990 && v <= 2040 && !/[.,]/.test(raw))) out.add(String(v));
  }
  return out;
}
export function keywords(text: string): Set<string> {
  return new Set(fold(text).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
}

export type Known = { id: string; headline: string; summary?: string | null; happened_on: string | null; story_id: string | null; company_ids?: string[]; asset_ids?: string[] };

/**
 * Devuelve la señal conocida que describe el mismo hecho, o null.
 * Mismo hecho = (comparten una cifra significativa y al menos 2 palabras clave) o (comparten empresa o
 * activo y al menos 3 palabras clave) o (≥ 60 % de las palabras clave del más corto), dentro de `days`.
 */
export function sameEvent(s: { headline: string; summary?: string | null; happened_on?: string | null; company_ids?: string[]; asset_ids?: string[] }, known: Known[], days = 14, today = new Date()): Known | null {
  const text = `${s.headline} ${s.summary ?? ""}`;
  const f = figures(text);
  const k = keywords(text);
  let best: { k: Known; score: number } | null = null;
  for (const x of known) {
    if (x.happened_on && Math.abs(new Date(x.happened_on).getTime() - (s.happened_on ? new Date(s.happened_on) : today).getTime()) > days * 86_400_000) continue;
    const xt = `${x.headline} ${x.summary ?? ""}`;
    const xk = keywords(xt);
    const shared = [...k].filter((w) => xk.has(w)).length;
    const sharedFig = [...figures(xt)].some((n) => f.has(n));
    const sharedEntity = (s.company_ids ?? []).some((id) => x.company_ids?.includes(id)) || (s.asset_ids ?? []).some((id) => x.asset_ids?.includes(id));
    const ratio = shared / Math.max(1, Math.min(k.size, xk.size));
    const same = (sharedFig && shared >= 2) || (sharedEntity && shared >= 3) || ratio >= 0.6;
    if (same && (!best || ratio > best.score)) best = { k: x, score: ratio };
  }
  return best?.k ?? null;
}
