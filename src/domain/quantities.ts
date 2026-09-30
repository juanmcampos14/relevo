// Cifras con unidad, sin IA: "USD 380.000", "2.400 m²", "hasta 18.000 pesos", "35 personas", "18%".
// La principal se guarda en la evidencia para calcular (USD/m², variación contra referencias).

export type Quantity = { value: number; unit: "moneda" | "m2" | "personas" | "porcentaje"; currency?: "USD" | "ARS" };

/** "2.400" → 2400 · "1.250,5" → 1250.5 · "380 mil" → 380000 · "1,2 millones" → 1200000. */
function num(raw: string, scale?: string): number {
  let s = raw.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/[.,](?=\d{3}\b)/g, "");
  let n = Number(s);
  if (scale && /^(mill[oó]n|millones|palos)/i.test(scale)) n *= 1_000_000;
  else if (scale && /^mil$/i.test(scale)) n *= 1000;
  return n;
}

const N = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`;
const SCALE = String.raw`(?:\s*(millones|mill[oó]n|palos|mil)\b)?`;

export function parseQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  const t = text.replace(/\s+/g, " ");
  const money = [
    new RegExp(String.raw`(?:US\$|U\$S|USD|u\$s|d[oó]lares)\s*${N}${SCALE}`, "gi"),
    new RegExp(String.raw`${N}${SCALE}\s*(?:de\s+)?(?:US\$|U\$S|USD|u\$s|d[oó]lares)`, "gi"),
    new RegExp(String.raw`(?:\$|ARS)\s*${N}${SCALE}`, "gi"),
    new RegExp(String.raw`${N}${SCALE}\s*(?:de\s+)?(?:pesos|ARS)`, "gi"),
  ];
  money.forEach((re, i) => {
    for (const m of t.matchAll(re)) {
      const value = num(m[1], m[2]);
      if (Number.isFinite(value) && value > 0) out.push({ value, unit: "moneda", currency: i < 2 ? "USD" : "ARS" });
    }
  });
  for (const m of t.matchAll(new RegExp(String.raw`${N}\s*(?:m2|m²|mts2|metros cuadrados|metros)`, "gi"))) out.push({ value: num(m[1]), unit: "m2" });
  for (const m of t.matchAll(new RegExp(String.raw`${N}\s*(?:personas|trabajadores|empleados|operarios)`, "gi"))) out.push({ value: num(m[1]), unit: "personas" });
  for (const m of t.matchAll(new RegExp(String.raw`${N}\s*%`, "g"))) out.push({ value: num(m[1]), unit: "porcentaje" });
  // Un mismo monto puede matchear dos patrones ("USD 380.000 dólares"): sin repetidos.
  return out.filter((q, i) => out.findIndex((x) => x.value === q.value && x.unit === q.unit && x.currency === q.currency) === i);
}

/** La cifra principal de un dato: primero dinero, después superficie, personas, porcentaje. */
export function mainQuantity(text: string): Quantity | null {
  const qs = parseQuantities(text);
  for (const u of ["moneda", "m2", "personas", "porcentaje"] as const) {
    const q = qs.find((x) => x.unit === u);
    if (q) return q;
  }
  return null;
}

/** Precio por m² y diferencia contra referencias (misma moneda). Todo es cálculo, con su fórmula. */
export function pricePerM2(price: number, surface: number): number {
  return Math.round((price / surface) * 100) / 100;
}

export function compareToReferences(value: number, refs: number[]): { median: number; diffPct: number; min: number; max: number } | null {
  if (!refs.length) return null;
  const s = [...refs].sort((a, b) => a - b);
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { median, diffPct: Math.round(((value - median) / median) * 100), min: s[0], max: s[s.length - 1] };
}
