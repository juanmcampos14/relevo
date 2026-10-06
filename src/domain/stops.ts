// Parada de una jornada de campo: puede ser una empresa (objetivo de la misión), una persona, un lugar, un
// evento, una zona o una actividad libre. Toda parada es operable: se completa, se mueve, se cancela, se le
// captura evidencia y deja una próxima acción. Puro y testeable.

export const STOP_KINDS = ["empresa", "persona", "lugar", "evento", "zona", "libre"] as const;
export type StopKind = (typeof STOP_KINDS)[number];
export const STOP_KIND_LABEL: Record<StopKind, string> = { empresa: "Empresa", persona: "Persona", lugar: "Lugar", evento: "Evento", zona: "Zona", libre: "Actividad libre" };

/** Estados guardados (los de siempre + en curso y cancelada). */
export const STOP_STATUSES = ["programada", "confirmada", "en_curso", "realizada", "no_realizada", "cancelada"] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

/** Los cinco estados del campo: planificada, en curso, hecha, salteada, cancelada. */
export type StopState = "planificada" | "en_curso" | "hecha" | "salteada" | "cancelada";
export const stopState = (s: StopStatus): StopState =>
  s === "programada" || s === "confirmada" ? "planificada" : s === "en_curso" ? "en_curso" : s === "realizada" ? "hecha" : s === "no_realizada" ? "salteada" : "cancelada";
export const STOP_STATE_LABEL: Record<StopState, string> = { planificada: "Planificada", en_curso: "En curso", hecha: "Hecha", salteada: "Salteada", cancelada: "Cancelada" };
/** ¿Sigue pendiente (cuenta para el recorrido y para "Hoy")? */
export const stopPending = (s: StopStatus) => stopState(s) === "planificada" || stopState(s) === "en_curso";

export type StopInput = { kind: StopKind; target_id?: string | null; contact_id?: string | null; label?: string | null };

/** La misma regla que la base: una empresa necesita su objetivo; una persona, su contacto o un nombre; lo demás, un nombre. */
export function stopIsValid(s: StopInput): boolean {
  const named = !!s.label?.trim();
  if (s.kind === "empresa") return !!s.target_id;
  if (s.kind === "persona") return !!s.contact_id || named;
  return named;
}

/** Cómo se nombra una parada: la entidad si existe; si no, su etiqueta. */
export function stopTitle(s: { kind: StopKind; label?: string | null }, entityName?: string | null): string {
  return entityName?.trim() || s.label?.trim() || STOP_KIND_LABEL[s.kind];
}
