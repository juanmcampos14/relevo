// Una conversación es UN evento de evidencia. Si se vuelve a subir el mismo audio o un texto
// prácticamente idéntico, no es una fuente nueva: se detecta antes de extraer nada.

/** Texto comparable: sin encabezados de transcripción, sin puntuación ni mayúsculas ni espacios de más. */
export function normalizeContent(text: string): string {
  return text
    .replace(/\[Audio \d+[^\]]*\]/g, " ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text: string, n = 3): Set<string> {
  const w = text.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  if (!out.size && w.length) out.add(w.join(" "));
  return out;
}

/** Parecido entre dos textos normalizados (Jaccard de trigramas de palabras), 0 a 1. */
export function contentSimilarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Umbral: por encima, es "prácticamente la misma conversación" (dos transcripciones del mismo audio rondan 0,8–1). */
export const NEAR_DUPLICATE = 0.75;
/** Por debajo de este largo no se compara por parecido (una nota corta se repite por casualidad). */
export const MIN_WORDS = 12;
