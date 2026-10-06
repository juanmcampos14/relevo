// Reconciliación: antes de crear algo, ¿ya lo conocemos? Y si llega un dato nuevo, ¿qué cambia de lo que
// creíamos? RELEVO no importa información: entiende qué cambia. Puro y testeable.

import { normalizeName } from "@/domain/crm-import/dedupe";
import { candidateState, capacityGap, type Card, type PartyRole, type Section } from "@/domain/candidate";

// Palabras que no identifican a una empresa: la localidad, la forma jurídica (ya la saca normalizeName) y
// rótulos genéricos. "Lavandería X", "Lavandería X Añelo" y "Lavandería X SRL" son la misma.
const NOISE = new Set(["anelo", "neuquen", "nqn", "vaca", "muerta", "sucursal", "filial", "argentina", "patagonia", "grupo", "la", "el", "los", "las", "de", "del", "y"]);

/** Clave de identidad de una entidad por su nombre. */
export function entityKey(name: string): string {
  return normalizeName(name).split(" ").filter((t) => t && !NOISE.has(t)).join(" ");
}

export type MatchKind = "misma" | "posible" | "distinta";

/**
 * ¿Es la misma entidad? misma = misma clave (o una contiene a la otra con al menos dos palabras propias);
 * posible = comparten la palabra distintiva pero no alcanza (se pregunta, nunca se une solo); distinta.
 */
export function entityMatch(a: string, b: string): MatchKind {
  const ka = entityKey(a);
  const kb = entityKey(b);
  if (!ka || !kb) return "distinta";
  if (ka === kb) return "misma";
  const ta = ka.split(" ");
  const tb = kb.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length >= 2 && short.every((t) => long.includes(t))) return "misma";
  const shared = ta.filter((t) => t.length >= 4 && tb.includes(t));
  return shared.length ? "posible" : "distinta";
}

/** La mejor coincidencia en una lista (misma antes que posible). */
export function bestMatch<T extends { id: string; names: string[] }>(name: string, pool: T[]): { item: T; kind: Exclude<MatchKind, "distinta"> } | null {
  let possible: T | null = null;
  for (const it of pool) {
    const kinds = it.names.filter(Boolean).map((n) => entityMatch(name, n));
    if (kinds.includes("misma")) return { item: it, kind: "misma" };
    if (!possible && kinds.includes("posible")) possible = it;
  }
  return possible ? { item: possible, kind: "posible" } : null;
}

export type ListingLike = { url?: string | null; title: string; locality?: string | null; surface_m2?: number | null; operation?: string | null; prices?: number[] };

/**
 * ¿Una publicación es un activo que ya seguimos? Misma URL de ficha → mismo; misma operación, localidad
 * compatible y superficie a ±5 % → mismo (un precio nuevo es una observación más, no un activo nuevo).
 */
export function sameListing(a: ListingLike, b: ListingLike): boolean {
  const ficha = (u?: string | null) => (u && /\/(propiedades|clasificado|p\/|propiedad|MLA-)/i.test(u) ? u.replace(/[?#].*$/, "").toLowerCase() : null);
  if (ficha(a.url) && ficha(a.url) === ficha(b.url)) return true;
  if (!a.surface_m2 || !b.surface_m2) return false;
  if (a.operation && b.operation && a.operation !== b.operation) return false;
  const near = Math.abs(a.surface_m2 - b.surface_m2) / Math.max(a.surface_m2, b.surface_m2) <= 0.05;
  const loc = (s?: string | null) => entityKey(s ?? "");
  const sameLoc = !loc(a.locality) || !loc(b.locality) || loc(a.locality).split(" ").some((t) => loc(b.locality).includes(t));
  return near && sameLoc;
}

export type CandidateImpact = {
  /** ¿Cambia lo que creíamos? */
  changed: boolean;
  before: string;
  learned: string;
  /** Qué cambia, en una oración. */
  effect: string;
  weakened: string[];
  reinforced: string[];
  stillUnknown: string[];
  nextQuestion: string | null;
};

const PARTY = { consumidor: "quién lo usa", decisor: "quién decide", pagador: "quién paga" } as Record<PartyRole, string>;
const SECTION_UNKNOWN: Record<Section, string> = {
  negocio: "cómo gana plata y sus contratos", demanda: "la demanda real", limitante: "qué le impide crecer", capacidad: "la capacidad realmente disponible",
  palanca: "dónde crear valor", economics: "precio y costo por unidad", riesgos: "los riesgos", proxima_validacion: "qué tendría que pasar para avanzar",
};

/**
 * Qué significa un dato nuevo para un candidato: compara lo que creíamos antes con lo que se puede
 * concluir después (brecha de capacidad, secciones contradichas). No promueve ni descarta: dice qué se
 * debilitó o reforzó, qué sigue sin saberse y qué preguntar.
 */
export function candidateImpact(before: Card, after: Card, parties: { role: PartyRole }[], unit: string | null, learned: string): CandidateImpact {
  const g0 = capacityGap(before, unit);
  const g1 = capacityGap(after, unit);
  const s1 = candidateState(after, parties, unit);
  const s0 = candidateState(before, parties, unit);
  const weakened: string[] = [];
  const reinforced: string[] = [];
  if (g0.gapNow && g1.gapAfterFuture === false) weakened.push(`Existe demanda insatisfecha (${g0.explanation.replace(/\.$/, "")}).`);
  if (g0.gapNow && g1.gapAfterFuture === true && g0.gapAfterFuture !== true) reinforced.push("La brecha sigue aun con la capacidad que se anuncia.");
  if (g0.gapNow === null && g1.gapNow === true) reinforced.push(`Hay demanda que no se atiende (${g1.explanation.replace(/\.$/, "")}).`);
  for (const s of s1.contradicted) if (!s0.contradicted.includes(s)) weakened.push(`Lo que creíamos sobre ${SECTION_UNKNOWN[s]} tiene evidencia en contra.`);
  const changed = weakened.length > 0 || reinforced.length > 0;
  const effect = weakened.length
    ? g1.gapAfterFuture === false ? "La existencia de una brecha real queda cuestionada." : "Se debilita lo que creíamos."
    : reinforced.length ? "Se refuerza lo que creíamos." : "No cambia lo que creíamos: suma evidencia.";
  const stillUnknown = [
    ...(g1.gapNow !== null ? ["cuánta de la capacidad anunciada está realmente disponible y cuándo"] : []),
    ...s1.missing.map((s) => SECTION_UNKNOWN[s]),
    ...s1.missingParties.map((r) => PARTY[r]),
  ].filter((x, i, a) => a.indexOf(x) === i);
  const nextQuestion = weakened.length && g1.gapAfterFuture === false
    ? "¿La capacidad nueva va a estar disponible, cuándo y a qué precio? ¿La demanda que hoy no se atiende la puede tomar quien la suma?"
    : s1.nextQuestion;
  return { changed, before: g0.gapNow ? g0.explanation : s0.known.map((k) => k.summary).join(" · ") || "Poco: la ficha estaba vacía.", learned, effect, weakened, reinforced, stillUnknown, nextQuestion };
}
