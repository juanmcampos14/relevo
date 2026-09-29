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

// --- E1: efecto de nueva evidencia ----------------------------------------------

export type EffectKind = "primer_caso" | "segundo_caso" | "nuevo_caso" | "mismo_caso" | "contradice" | "contexto";
export type Effect = { findingId: string; statement: string; kinds: EffectKind[]; text: string };

const quoteStmt = (s: string) => `«${s.length > 90 ? `${s.slice(0, 90)}…` : s}»`;

/**
 * ¿Qué cambió con esta evidencia? Para cada finding, compara las métricas sin y con la evidencia nueva.
 * "Mismo caso" = más evidencia de una empresa que ya estaba: refuerza pero no triangula.
 */
export function evidenceEffect(
  findings: { id: string; statement: string; links: EvidenceLink[] }[],
  newEvidenceIds: Set<string>,
  today: string,
): Effect[] {
  const out: Effect[] = [];
  for (const f of findings) {
    if (!f.links.some((l) => newEvidenceIds.has(l.id))) continue;
    const before = metrics(f.links.filter((l) => !newEvidenceIds.has(l.id)), today);
    const after = metrics(f.links, today);
    const kinds: EffectKind[] = [];
    const parts: string[] = [];
    if (after.contradicts > before.contradicts) {
      kinds.push("contradice");
      parts.push(`Contradice ${quoteStmt(f.statement)}: ahora hay ${after.contradicts} evidencia${after.contradicts === 1 ? "" : "s"} en contra.`);
    }
    if (after.independentCases > before.independentCases) {
      const k: EffectKind = before.independentCases === 0 ? "primer_caso" : before.independentCases === 1 ? "segundo_caso" : "nuevo_caso";
      kinds.push(k);
      parts.push(
        k === "primer_caso"
          ? `Es el primer caso de ${quoteStmt(f.statement)}.`
          : k === "segundo_caso"
            ? `Suma un segundo caso independiente a ${quoteStmt(f.statement)}: deja de ser un caso aislado.`
            : `Suma un caso más a ${quoteStmt(f.statement)}: ahora son ${after.independentCases}.`,
      );
    } else if (after.supports > before.supports) {
      kinds.push("mismo_caso");
      parts.push(`Refuerza ${quoteStmt(f.statement)} con más evidencia del mismo caso (no suma triangulación).`);
    }
    if (!kinds.length && after.contextual > before.contextual) {
      kinds.push("contexto");
      parts.push(`Agrega contexto a ${quoteStmt(f.statement)} sin cambiar su estado.`);
    }
    if (kinds.length) out.push({ findingId: f.id, statement: f.statement, kinds, text: parts.join(" ") });
  }
  // Lo que más cambia el entendimiento primero: contradicciones, después casos nuevos.
  const weight = (e: Effect) => (e.kinds.includes("contradice") ? 0 : e.kinds.some((k) => k.endsWith("caso") && k !== "mismo_caso") ? 1 : 2);
  return out.sort((a, b) => weight(a) - weight(b));
}

// --- E3: memoria de evolución ----------------------------------------------------

export type TimelineEvent = { at: string; kind: "apertura" | "caso" | "mismo_caso" | "contradiccion" | "contexto" | "faltante_resuelto" | "faltante_nuevo" | "validacion_agendada" | "validacion_hecha"; text: string };

/**
 * Cómo llegó un finding a su estado actual: se reconstruye en orden a partir de la evidencia
 * (cuándo se vinculó y si sumó un caso), los análisis (faltantes que aparecen o se resuelven) y las validaciones.
 */
export function findingTimeline(input: {
  createdAt: string;
  origin?: string | null;
  links: (EvidenceLink & { linkedAt: string; statement: string })[];
  assessments: { at: string; gaps: string[] }[];
  validations: { title: string; createdAt: string; completedAt: string | null }[];
}): TimelineEvent[] {
  const ev: TimelineEvent[] = [{ at: input.createdAt, kind: "apertura", text: `Se abrió la hipótesis${input.origin ? ` (${input.origin})` : ""}.` }];
  const sorted = [...input.links].sort((a, b) => a.linkedAt.localeCompare(b.linkedAt));
  const seen: EvidenceLink[] = [];
  for (const l of sorted) {
    const before = metrics(seen, "9999-12-31");
    seen.push(l);
    const after = metrics(seen, "9999-12-31");
    const s = `«${l.statement.length > 80 ? `${l.statement.slice(0, 80)}…` : l.statement}»`;
    if (l.stance === "contradicts") ev.push({ at: l.linkedAt, kind: "contradiccion", text: `Apareció evidencia en contra: ${s}.` });
    else if (l.stance === "contextual") ev.push({ at: l.linkedAt, kind: "contexto", text: `Contexto: ${s}.` });
    else if (after.independentCases > before.independentCases) {
      const n = after.independentCases;
      ev.push({ at: l.linkedAt, kind: "caso", text: `${n === 1 ? "Primer caso" : n === 2 ? "Segundo caso independiente" : `Caso independiente n.º ${n}`}: ${s}.` });
    } else ev.push({ at: l.linkedAt, kind: "mismo_caso", text: `Más evidencia del mismo caso: ${s}.` });
  }
  const asc = [...input.assessments].sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 1; i < asc.length; i++) {
    const prev = new Set(asc[i - 1].gaps);
    const cur = new Set(asc[i].gaps);
    for (const g of prev) if (!cur.has(g)) ev.push({ at: asc[i].at, kind: "faltante_resuelto", text: `Se resolvió: ${GAPS[g as Gap]?.label ?? g}.` });
    for (const g of cur) if (!prev.has(g)) ev.push({ at: asc[i].at, kind: "faltante_nuevo", text: `Nuevo faltante: ${GAPS[g as Gap]?.label ?? g}.` });
  }
  for (const v of input.validations) {
    ev.push({ at: v.createdAt, kind: "validacion_agendada", text: `Validación agendada: ${v.title}.` });
    if (v.completedAt) ev.push({ at: v.completedAt, kind: "validacion_hecha", text: `Validación hecha: ${v.title}.` });
  }
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

/** Tendencia desde una fecha: se fortaleció (más casos, sin contraevidencia nueva), se debilitó (contraevidencia nueva) o sin cambios. */
export function trendSince(events: TimelineEvent[], since: string): "se_fortalecio" | "se_debilito" | "en_disputa" | "sin_cambios" {
  const recent = events.filter((e) => e.at >= since);
  const up = recent.some((e) => e.kind === "caso" || e.kind === "faltante_resuelto");
  const down = recent.some((e) => e.kind === "contradiccion");
  return up && down ? "en_disputa" : down ? "se_debilito" : up ? "se_fortalecio" : "sin_cambios";
}

// --- E4: valor de información -----------------------------------------------------

export type VoiCandidate = {
  findingId: string;
  statement: string;
  gaps: Gap[];
  dimensions: Dimension[];
  supports: number;
  contradicts: number;
  independentCases: number;
  /** Validaciones propuestas por la IA sin decidir, en orden. */
  proposed: { title: string; why: string; gap: Gap }[];
  /** Validaciones ya agendadas y abiertas. */
  scheduled: { title: string; due: string | null }[];
};

export type ResearchPriority = {
  findingId: string;
  statement: string;
  action: string;
  scheduled: boolean;
  why: string;
  toLearn: string[];
  stage: "resolver" | "comprador" | "triangular" | "economia" | "profundizar";
};

const STAGE_GAP: Record<ResearchPriority["stage"], Gap | null> = {
  resolver: "contradiccion_sin_resolver",
  comprador: "falta_comprador",
  triangular: "falta_triangulacion",
  economia: "falta_economia",
  profundizar: null,
};
const STAGE_LEARN: Record<ResearchPriority["stage"], DimensionKey[]> = {
  resolver: ["problema", "solucion_actual", "frecuencia"],
  comprador: ["comprador", "decisor", "presupuesto"],
  triangular: ["frecuencia", "problema", "actor_afectado"],
  economia: ["impacto", "presupuesto", "condicion_cambio"],
  profundizar: ["alternativas", "condicion_cambio", "piloto"],
};

/**
 * ¿Qué validación reduce más la incertidumbre que importa para decidir? Sin puntaje visible:
 * el orden sale de una regla explícita y cada prioridad trae su porqué.
 * 1) una contradicción abierta puede confirmar o descartar la hipótesis;
 * 2) con el problema repetido en 2+ casos, lo que falta para decidir es quién compra;
 * 3) con un solo caso, un segundo caso confirma que no es aislado (o lo debilita);
 * 4) con problema y comprador, falta la economía.
 */
export function valueOfInformation(cands: VoiCandidate[], max = 3): ResearchPriority[] {
  const missing = (c: VoiCandidate, k: DimensionKey) => {
    const d = c.dimensions.find((x) => x.key === k);
    return !d || d.status === "falta";
  };
  const q = (s: string) => `«${s.length > 70 ? `${s.slice(0, 70)}…` : s}»`;
  const scored = cands.flatMap((c) => {
    let stage: ResearchPriority["stage"];
    let value: number;
    let why: string;
    if (c.contradicts > 0) {
      stage = "resolver";
      value = 100 + c.supports;
      why = `Hay ${c.supports} evidencia${c.supports === 1 ? "" : "s"} a favor y ${c.contradicts} en contra: resolver la contradicción puede confirmar o descartar ${q(c.statement)}.`;
    } else if (c.supports === 0) {
      return [];
    } else if (c.independentCases >= 2 && (missing(c, "comprador") || missing(c, "decisor"))) {
      stage = "comprador";
      value = 80 + c.independentCases * 3;
      why = `Tenemos ${c.independentCases} casos independientes del problema pero todavía no sabemos quién paga ni quién decide: sin comprador no hay decisión posible.`;
    } else if (c.independentCases < 2) {
      stage = "triangular";
      value = 60;
      why = "Hay un solo caso: un segundo caso independiente confirma que no es algo aislado, o debilita la hipótesis.";
    } else if (missing(c, "impacto") || missing(c, "presupuesto")) {
      stage = "economia";
      value = 55;
      why = "El problema se repite y sabemos quién decide, pero no cuánto cuesta: sin economía no se puede evaluar.";
    } else {
      stage = "profundizar";
      value = 30;
      const g = c.gaps[0];
      why = g ? GAPS[g].why : "Queda por entender la solución actual y la condición de cambio.";
    }
    const gap = STAGE_GAP[stage];
    const scheduled = c.scheduled[0];
    const proposed = c.proposed.find((p) => p.gap === gap) ?? c.proposed[0];
    const action =
      scheduled?.title ??
      proposed?.title ??
      (stage === "triangular" ? `Buscar un segundo caso para ${q(c.statement)}` : stage === "comprador" ? `Identificar quién compra y quién decide en los casos de ${q(c.statement)}` : `Validar ${q(c.statement)}`);
    const toLearn = STAGE_LEARN[stage].filter((k) => missing(c, k)).map(dimensionLabel);
    return [{ value, p: { findingId: c.findingId, statement: c.statement, action, scheduled: !!scheduled, why, toLearn, stage } }];
  });
  return scored.sort((a, b) => b.value - a.value).slice(0, max).map((x) => x.p);
}
