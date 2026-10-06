// Guardrail de promoción: una hipótesis no es hallazgo por acumular señales compatibles. No se bloquea la
// promoción manual, pero sin evidencia se avisa y se pide confirmación; si se promueve igual, queda en la
// historia quién, cuándo, de qué a qué y por qué (caso H-VA-02). Puro y testeable.

export type PromotionFacts = { evidence: number; supports: number; independentCases: number; gaps: string[] };

const SERIOUS = new Set(["evidencia_insuficiente", "falta_recurrencia", "falta_comprador", "falta_solucion_actual", "contradiccion_sin_resolver"]);

/** Aviso antes de promover a hallazgo o caso; null si la evidencia alcanza para no preguntar. */
export function promotionWarning(to: "hipotesis" | "finding" | "caso", f: PromotionFacts): string | null {
  if (to === "hipotesis") return null;
  const reasons: string[] = [];
  if (f.evidence === 0) reasons.push("no tiene evidencia vinculada");
  else if (f.supports === 0) reasons.push("ninguna evidencia la apoya");
  if (f.independentCases === 0) reasons.push("no hay casos independientes");
  const serious = f.gaps.filter((g) => SERIOUS.has(g));
  if (serious.length) reasons.push(`faltan cosas importantes (${serious.map((g) => g.replace(/_/g, " ")).join(", ")})`);
  if (!reasons.length) return null;
  return `Esta hipótesis ${reasons.join("; ")}. ¿Promover igualmente?`;
}
