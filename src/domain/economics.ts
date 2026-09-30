// Economía de un caso: cada variable con su base, sin puntaje. Lo que no aparece es DESCONOCIDO.
export const ECONOMICS = {
  usuarios: "Usuarios / población afectada",
  frecuencia: "Frecuencia",
  volumen: "Volumen",
  precio: "Precio / gasto actual",
  pagador: "Quién paga",
  comprador: "Quién compra / decide",
  proveedor_actual: "Proveedor o solución actual",
  contrato: "Contrato / condiciones",
  capex: "CAPEX",
  opex: "OPEX",
  margen: "Margen",
  condicion_cambio: "Condición para cambiar",
} as const;
export type EconomicKey = keyof typeof ECONOMICS;
export const ECONOMIC_KEYS = Object.keys(ECONOMICS) as [EconomicKey, ...EconomicKey[]];

export type EconomicBasis = "observado" | "declarado" | "calculado" | "estimado";
export const BASIS_LABEL: Record<EconomicBasis | "desconocido", string> = {
  observado: "observado",
  declarado: "declarado",
  calculado: "calculado",
  estimado: "estimado",
  desconocido: "desconocido",
};

export type EconomicFact = { variable: EconomicKey; value: string; basis: EconomicBasis; formula: string | null; evidence_ids: string[] };

/**
 * Control de lo que devuelve la IA: sin evidencia real no hay "observado" ni "declarado"
 * (pasa a estimado); sin fórmula no hay "calculado". Una variable, una vez.
 */
export function sanitizeEconomics(facts: EconomicFact[], evidenceIds: Set<string>): EconomicFact[] {
  const seen = new Set<string>();
  const out: EconomicFact[] = [];
  for (const f of facts) {
    if (!(f.variable in ECONOMICS) || seen.has(f.variable) || !f.value?.trim()) continue;
    seen.add(f.variable);
    const ids = f.evidence_ids.filter((id) => evidenceIds.has(id));
    let basis = f.basis;
    if ((basis === "observado" || basis === "declarado") && !ids.length) basis = "estimado";
    if (basis === "calculado" && !f.formula?.trim()) basis = "estimado";
    out.push({ variable: f.variable, value: f.value.trim(), basis, formula: basis === "calculado" ? f.formula!.trim() : null, evidence_ids: ids });
  }
  return out.sort((a, b) => ECONOMIC_KEYS.indexOf(a.variable) - ECONOMIC_KEYS.indexOf(b.variable));
}

/** Qué variables económicas todavía no conocemos. */
export function unknownEconomics(facts: EconomicFact[]): EconomicKey[] {
  const known = new Set(facts.map((f) => f.variable));
  return ECONOMIC_KEYS.filter((k) => !known.has(k));
}
