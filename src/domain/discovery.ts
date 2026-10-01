// Capa de discovery de una hipótesis: lo que el Brain necesita para responder, en una conversación,
// qué creemos, por qué, con qué evidencia, qué falta, cómo lo validaríamos y quién puede ayudarnos.
// Investigamos para cerrar gaps: cada "quién" viene con su propósito y qué preguntarle.

export const PURPOSES = {
  comprar_asociar: "Comprar / asociarnos",
  vender_crear: "Vender / crear",
  inteligencia: "Inteligencia",
} as const;
export type Purpose = keyof typeof PURPOSES;
export const PURPOSE_KEYS = Object.keys(PURPOSES) as [Purpose, ...Purpose[]];

export const EVIDENCE_LEVELS = {
  nula: "Nula: solo diseño del equipo, sin evidencia.",
  baja: "Baja: contexto externo o una sola declaración.",
  media: "Media: varias declaraciones u observaciones relacionadas.",
  alta: "Alta: casos independientes vinculados y verificados.",
} as const;
export type EvidenceLevel = keyof typeof EVIDENCE_LEVELS;
export const EVIDENCE_LEVEL_KEYS = Object.keys(EVIDENCE_LEVELS) as [EvidenceLevel, ...EvidenceLevel[]];

/** Lado de la demanda: quienes compran, pagan, asignan o deciden (operadoras, contratistas, compradores corporativos). */
export const DEMAND_SECTOR = /comprador corporativo|contratista|petroler|operadora|log[ií]stica petrolera|obras y maquinaria|infraestructura|servicios industriales|miner/i;
/** Roles que suelen comprar o decidir del lado de la demanda. */
export const BUYER_ROLE = /compras|procurement|supply|abastecimiento|contratos|recursos humanos|rrhh|facilities|supplier|planificaci[oó]n/i;

export type Helper = { ref: string; name: string; purpose: Purpose; why: string; ask: string };
export type Discovery = {
  belief: string;
  why: string;
  evidence_level: EvidenceLevel;
  evidence_summary: string;
  evidence_refs: string[];
  signal_refs: string[];
  question_refs: string[];
  who_can_help: Helper[];
};

type RawHelper = { ref: string; purpose: string; why: string; ask: string };
export type RawDiscovery = Omit<Discovery, "who_can_help" | "evidence_level"> & { evidence_level: string; who_can_help: RawHelper[] };

/**
 * Deja solo referencias que el análisis efectivamente vio (nunca ids inventados) y nombra a cada
 * persona o empresa desde los datos, no desde el texto del modelo. Sin evidencia vista, el nivel no
 * puede ser más que "nula": el diseño del equipo no es evidencia.
 */
export function sanitizeDiscovery(raw: RawDiscovery | null | undefined, seen: { evidence: Set<string>; signals: Set<string>; questions: Set<string>; people: Map<string, string>; purposes?: Map<string, Purpose> }): Discovery | null {
  if (!raw) return null;
  const keep = (refs: string[] | undefined, allowed: Set<string>, n: number) => [...new Set((refs ?? []).filter((r) => allowed.has(r)))].slice(0, n);
  const evidence_refs = keep(raw.evidence_refs, seen.evidence, 12);
  const signal_refs = keep(raw.signal_refs, seen.signals, 8);
  let level = (EVIDENCE_LEVEL_KEYS as string[]).includes(raw.evidence_level) ? (raw.evidence_level as EvidenceLevel) : "nula";
  if (!evidence_refs.length && !signal_refs.length) level = "nula";
  else if (!evidence_refs.length && level !== "nula") level = "baja";
  const helpers: Helper[] = [];
  for (const h of raw.who_can_help ?? []) {
    const name = seen.people.get(h.ref);
    if (!name || helpers.some((x) => x.ref === h.ref)) continue;
    // El propósito es lo que el actor representa para la misión: si ya está definido en su objetivo, manda ese.
    const purpose = seen.purposes?.get(h.ref) ?? ((PURPOSE_KEYS as string[]).includes(h.purpose) ? (h.purpose as Purpose) : "inteligencia");
    helpers.push({ ref: h.ref, name, purpose, why: h.why.trim(), ask: h.ask.trim() });
    if (helpers.length === 5) break;
  }
  return {
    belief: raw.belief.trim(),
    why: raw.why.trim(),
    evidence_level: level,
    evidence_summary: raw.evidence_summary.trim(),
    evidence_refs,
    signal_refs,
    question_refs: keep(raw.question_refs, seen.questions, 6),
    who_can_help: helpers,
  };
}
