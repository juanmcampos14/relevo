// Cambio material: la única pregunta que gobierna el trabajo de fondo y la Surface — "¿esto cambia algo que
// importa para la misión?". Si no: silencio (se guarda la fuente, no se recalcula, no se muestra). Si sí:
// se actualiza el Brain, se re-sintetiza, se rehace Avanzar y puede aparecer en "Desde tu última visita".
// Puro y testeable; la lectura de la base vive en src/server/mission/material.ts.

import { figures, keywords, sameEvent, type Known } from "@/domain/brief/same-event";

export type SignalChange = "nuevo" | "actualizado" | "confirmado" | "contradicho" | "descartado";
export type Relevance = "alta" | "media" | "baja";

/** Una señal sola es material si cambia algo (no re-confirma) y no es ruido de relevancia baja. */
export const isMaterialSignal = (s: { change: SignalChange; relevance: Relevance }) =>
  (s.change === "nuevo" || s.change === "actualizado" || s.change === "contradicho") && s.relevance !== "baja";

// Lo que convierte una nota repetida en un dato nuevo: contrato, adjudicación, precio, fecha, operador,
// ubicación, compra/venta, cambio de estado. Raíces sin tildes (se comparan contra keywords()).
// Cada grupo es un mismo concepto ("abre", "abrirá", "apertura" = apertura): dos medios que lo dicen con
// otras palabras no aportan nada nuevo.
const MATERIAL_GROUPS: Record<string, string[]> = {
  // Primero las fechas: "abril" no es "abrir".
  fecha: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  contrato: ["contrat", "firm", "acuerd", "conveni"],
  adjudicacion: ["adjudic", "licit", "concurs"],
  apertura: ["inaugur", "abre", "abri", "apertura", "desembarc", "lleg", "instal", "arrib"],
  cierre: ["cierr", "cerr", "clausur"],
  operacion_comercial: ["compr", "vend", "venta", "adquir", "adquisic"],
  alquiler: ["alquil", "arrend"],
  precio: ["precio", "tarifa", "usd", "dolar", "cotiz", "valuac"],
  operador: ["operador", "operar", "operara", "franquic", "concesion"],
  ubicacion: ["ubicad", "ubicacion", "terreno", "galpon", "predio", "parcela", "lote"],
  socio: ["socio", "sociedad", "alianza"],
  inversion: ["inversion", "invert", "invier", "financ"],
  habilitacion: ["aprob", "habilit", "permiso", "autoriz"],
  freno: ["suspend", "cancel", "posterg", "demor", "frena"],
  crisis: ["quiebr", "despid", "conflict", "paro"],
};
const STEMS = Object.entries(MATERIAL_GROUPS).flatMap(([g, xs]) => xs.map((x) => [x, g] as const));
const stem = (w: string) => STEMS.find(([s]) => w.startsWith(s))?.[1] ?? null;

/** Qué trae de nuevo una nota sobre un hecho ya conocido (cifras, empresas/activos o términos materiales que el hecho no tenía). */
export function novelty(s: { headline: string; summary?: string | null; company_ids?: string[]; asset_ids?: string[] }, event: { text: string; company_ids: string[]; asset_ids: string[] }): string[] {
  const text = `${s.headline} ${s.summary ?? ""}`;
  const knownFig = figures(event.text);
  const knownStems = new Set([...keywords(event.text)].map(stem).filter((x): x is string => !!x));
  const out: string[] = [];
  for (const f of figures(text)) if (!knownFig.has(f)) out.push(`cifra ${f}`);
  for (const id of s.company_ids ?? []) if (!event.company_ids.includes(id)) out.push(`empresa ${id}`);
  for (const id of s.asset_ids ?? []) if (!event.asset_ids.includes(id)) out.push(`activo ${id}`);
  const seen = new Set<string>();
  for (const w of keywords(text)) {
    const st = stem(w);
    if (st && !knownStems.has(st) && !seen.has(st)) { seen.add(st); out.push(st); }
  }
  return out;
}

// Nombres propios de dos o más palabras ("Café Martínez", "Grupo Sur"): dos notas que nombran lo mismo
// en la misma ventana hablan del mismo hecho aunque una sea mucho más rica. La geografía no cuenta.
const PLACES = new Set(["vaca muerta", "rio negro", "buenos aires", "la pampa", "santa cruz", "neuquen capital", "plaza huincul", "rincon de los sauces", "cutral co", "san patricio"]);
const foldName = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
export function names(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\p{Lu}[\p{L}'’]+(?:\s+\p{Lu}[\p{L}'’]+)+/gu)) {
    const words = m[0].split(/\s+/).map(foldName);
    for (let i = 0; i + 1 < words.length; i++) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (!PLACES.has(pair) && !words.slice(i, i + 2).some((w) => w === "anelo" || w === "neuquen")) out.add(pair);
    }
  }
  return out;
}

/** Un hecho conocido de la misión: la señal canónica con el texto de todas sus fuentes. */
export type KnownEvent = Known & { text: string; company_ids: string[]; asset_ids: string[] };

export type Placement =
  | { kind: "nueva"; material: boolean; change: SignalChange }
  | { kind: "misma"; eventId: string; material: false; change: "confirmado" }
  | { kind: "actualiza"; eventId: string; material: true; change: "actualizado"; novel: string[] };

/**
 * ¿Dónde va una señal? Artículo ≠ hecho: si describe un hecho que ya conocemos, es una fuente más (no
 * material) salvo que aporte un dato nuevo — entonces actualiza el hecho y vuelve a ser material.
 * `sameAs` es la pista del modelo (el id del hecho que reconoció); la heurística determinística es la red.
 */
export function placeSignal(
  s: { headline: string; summary?: string | null; happened_on?: string | null; company_ids?: string[]; asset_ids?: string[]; change: SignalChange; relevance: Relevance; contradicts?: boolean },
  known: KnownEvent[],
  opts: { sameAs?: string | null; today?: Date } = {},
): Placement {
  const hinted = opts.sameAs ? known.find((k) => k.id === opts.sameAs) ?? null : null;
  const match = hinted ?? (sameEvent(s, known, 14, opts.today) as KnownEvent | null) ?? sameName(s, known, opts.today);
  if (!match) return { kind: "nueva", material: isMaterialSignal(s), change: s.change };
  // Una contradicción de lo que sabíamos siempre importa, aunque hable del mismo hecho.
  if (s.change === "contradicho" && s.relevance !== "baja") return { kind: "actualiza", eventId: match.id, material: true, change: "actualizado", novel: ["contradice"] };
  const novel = novelty(s, match);
  return novel.length && s.relevance !== "baja"
    ? { kind: "actualiza", eventId: match.id, material: true, change: "actualizado", novel }
    : { kind: "misma", eventId: match.id, material: false, change: "confirmado" };
}

/** Comparten un nombre propio distintivo y están a menos de 14 días: el mismo hecho contado por otro medio. */
function sameName(s: { headline: string; summary?: string | null; happened_on?: string | null }, known: KnownEvent[], today = new Date()): KnownEvent | null {
  const mine = names(`${s.headline} ${s.summary ?? ""}`);
  if (!mine.size) return null;
  const at = (s.happened_on ? new Date(s.happened_on) : today).getTime();
  return known.find((k) => (!k.happened_on || Math.abs(new Date(k.happened_on).getTime() - at) <= 14 * 86_400_000) && [...names(k.text)].some((n) => mine.has(n))) ?? null;
}

type Dimension = { key: string; status: string };
type Assessment = { dimensions: unknown; gaps: string[]; supports: number; contradicts: number };

/** ¿Una nueva evaluación de una hipótesis cambió lo que creemos? (estado de alguna dimensión, faltantes o contradicciones). */
export function assessmentChanged(prev: Assessment | null, next: Assessment): boolean {
  if (!prev) return true;
  const dims = (a: Assessment) => new Map(((a.dimensions as Dimension[] | null) ?? []).map((d) => [d.key, d.status]));
  const p = dims(prev);
  const n = dims(next);
  if (p.size !== n.size || [...n].some(([k, v]) => p.get(k) !== v)) return true;
  if (next.contradicts !== prev.contradicts) return true;
  const pg = new Set(prev.gaps);
  return next.gaps.length !== prev.gaps.length || next.gaps.some((g) => !pg.has(g));
}

/** Horizonte de agenda: una tarea o visita "se acerca" cuando entra en hoy/mañana. */
export const AGENDA_HORIZON_DAYS = 1;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** ¿Esta fecha entró en el horizonte (hoy/mañana) desde `since`? Pasa una vez: no despierta todos los días. */
export function enteredHorizon(on: string, since: Date, now: Date): boolean {
  const art = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return on > addDays(art(since), AGENDA_HORIZON_DAYS) && on <= addDays(art(now), AGENDA_HORIZON_DAYS);
}

export type MaterialKind = "senal" | "aporte" | "hipotesis" | "oportunidad" | "accion" | "agenda" | "correccion";
export type MaterialChange = { kind: MaterialKind; at: string; by: string | null; text: string; refs: string[] };

/** Cuánto sirve un Avanzar preparado como máximo (los textos llevan fechas relativas: "mañana", "esta semana"). */
export const MOVE_MAX_H = 72;
