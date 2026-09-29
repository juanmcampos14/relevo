// Estado de un finding (incremento D): qué sabemos, qué creemos, qué contradice y qué falta.
// Sin puntaje: dimensiones con estado + faltantes con nombre y porqué. Lo cuantificable (casos,
// evidencia a favor/en contra) se calcula acá, sin IA; la IA solo evalúa las dimensiones y siempre
// citando evidencia que exista.

export const DIMENSIONS = [
  { key: "problema", label: "Problema concreto" },
  { key: "actor_afectado", label: "Actor afectado" },
  { key: "frecuencia", label: "Frecuencia / recurrencia" },
  { key: "impacto", label: "Impacto" },
  { key: "usuario", label: "Usuario afectado" },
  { key: "comprador", label: "Comprador / pagador" },
  { key: "decisor", label: "Decisor" },
  { key: "solucion_actual", label: "Solución actual" },
  { key: "alternativas", label: "Alternativas / competencia" },
  { key: "condicion_cambio", label: "Condición de cambio" },
  { key: "presupuesto", label: "Presupuesto" },
  { key: "piloto", label: "Posibilidad de piloto" },
] as const;
export type DimensionKey = (typeof DIMENSIONS)[number]["key"];
export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key) as [DimensionKey, ...DimensionKey[]];
export const dimensionLabel = (k: string) => DIMENSIONS.find((d) => d.key === k)?.label ?? k;

export type DimensionStatus = "sabido" | "creido" | "contradicho" | "falta";
export type Dimension = { key: DimensionKey; status: DimensionStatus; summary: string; evidence_ids: string[] };

/** Faltantes explicables, en orden de prioridad para decidir qué validar primero. */
export const GAPS = {
  contradiccion_sin_resolver: { label: "Contradicción sin resolver", why: "Hay evidencia en contra que todavía nadie explicó." },
  evidencia_insuficiente: { label: "Evidencia insuficiente", why: "No hay evidencia a favor registrada." },
  falta_triangulacion: { label: "Falta triangulación", why: "Hay un solo caso independiente: puede ser un caso aislado." },
  falta_recurrencia: { label: "Falta validar recurrencia", why: "No sabemos con qué frecuencia pasa." },
  falta_comprador: { label: "Falta comprador", why: "No sabemos quién paga ni quién decide." },
  falta_economia: { label: "Falta economía", why: "No sabemos cuánto cuesta el problema ni si hay presupuesto." },
  falta_solucion_actual: { label: "Falta solución actual", why: "No sabemos cómo lo resuelven hoy ni contra qué competimos." },
  evidencia_desactualizada: { label: "Evidencia desactualizada", why: "Parte de la evidencia pasó su fecha de revalidación." },
} as const;
export type Gap = keyof typeof GAPS;
const GAP_ORDER = Object.keys(GAPS) as Gap[];

export type EvidenceLink = {
  id: string;
  stance: "supports" | "contradicts" | "contextual";
  verification_status: string;
  revalidate_after: string | null;
  company_id: string | null;
  stated_by_contact_id: string | null;
  capture_id: string | null;
  visit_id: string | null;
  source_id: string | null;
};

export type Metrics = { supports: number; contradicts: number; contextual: number; independentCases: number; verified: number; stale: number };

/**
 * Casos independientes: evidencia a favor que viene de empresas (o, si no hay empresa, personas,
 * capturas o fuentes) distintas. Dos datos de la misma empresa son un solo caso.
 */
export function metrics(links: EvidenceLink[], today: string): Metrics {
  const supports = links.filter((l) => l.stance === "supports");
  const cases = new Set(supports.map((l) => l.company_id ?? l.stated_by_contact_id ?? l.capture_id ?? l.visit_id ?? l.source_id ?? l.id));
  return {
    supports: supports.length,
    contradicts: links.filter((l) => l.stance === "contradicts").length,
    contextual: links.filter((l) => l.stance === "contextual").length,
    independentCases: cases.size,
    verified: links.filter((l) => l.verification_status === "publicly_verified" || l.verification_status === "field_verified").length,
    stale: links.filter((l) => l.verification_status === "stale" || (!!l.revalidate_after && l.revalidate_after < today)).length,
  };
}

/** Faltantes que se deducen sin IA de la evidencia vinculada. */
export function deterministicGaps(m: Metrics): Gap[] {
  const g: Gap[] = [];
  if (m.contradicts > 0) g.push("contradiccion_sin_resolver");
  if (m.supports === 0) g.push("evidencia_insuficiente");
  else if (m.independentCases < 2) g.push("falta_triangulacion");
  if (m.stale > 0) g.push("evidencia_desactualizada");
  return g;
}

export function gapsFromDimensions(dims: Dimension[]): Gap[] {
  const missing = (k: DimensionKey) => {
    const d = dims.find((x) => x.key === k);
    return !d || d.status === "falta";
  };
  const g: Gap[] = [];
  if (missing("frecuencia")) g.push("falta_recurrencia");
  if (missing("comprador") || missing("decisor")) g.push("falta_comprador");
  if (missing("impacto") || missing("presupuesto")) g.push("falta_economia");
  if (missing("solucion_actual")) g.push("falta_solucion_actual");
  return g;
}

export function orderGaps(gaps: Gap[]): Gap[] {
  return [...new Set(gaps)].sort((a, b) => GAP_ORDER.indexOf(a) - GAP_ORDER.indexOf(b));
}

/**
 * Lo que devuelve la IA se controla contra la evidencia real:
 * - solo dimensiones conocidas, una vez cada una (las que falten quedan "falta");
 * - las citas a evidencia que no está vinculada al finding se descartan;
 * - "sabido" sin evidencia citada pasa a "creido"; "contradicho" sin evidencia en contra citada, también.
 */
export function sanitizeDimensions(ai: { key: string; status: string; summary: string; evidence_ids: string[] }[], links: EvidenceLink[]): Dimension[] {
  const linked = new Map(links.map((l) => [l.id, l]));
  return DIMENSIONS.map(({ key }) => {
    const d = ai.find((x) => x.key === key);
    if (!d) return { key, status: "falta" as const, summary: "Sin información.", evidence_ids: [] };
    const ids = [...new Set(d.evidence_ids.filter((id) => linked.has(id)))];
    let status = (["sabido", "creido", "contradicho", "falta"].includes(d.status) ? d.status : "falta") as DimensionStatus;
    if (status === "sabido" && ids.length === 0) status = "creido";
    if (status === "contradicho" && !ids.some((id) => linked.get(id)!.stance === "contradicts")) status = "creido";
    return { key, status, summary: d.summary.trim() || "Sin información.", evidence_ids: ids };
  });
}

/** El análisis quedó viejo si cambió la evidencia vinculada desde que se hizo. */
export function isAssessmentStale(assessed: string[], current: string[]): boolean {
  const a = new Set(assessed);
  return a.size !== new Set(current).size || current.some((id) => !a.has(id));
}
