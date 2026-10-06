// Precedencia humana: lo que una persona corrigió o confirmó no lo pisa una ingesta automática. El dato
// que llega distinto no se descarta: queda como discrepancia ("encontré información diferente") para que
// una persona decida. Puro y testeable.

const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : typeof v === "string" ? v.trim() : JSON.stringify(v));

/** Qué campos cambió una edición humana (solo los que vienen en el patch). */
export function changedFields(before: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => norm(before[k]) !== norm(patch[k]));
}

/** Suma campos al bloqueo sin repetir. */
export const withLocks = (locked: string[] | null | undefined, fields: string[]) => [...new Set([...(locked ?? []), ...fields])].sort();

export type Split<T> = { apply: Partial<T>; discrepancies: { field: string; current: string | null; incoming: string | null }[] };

/**
 * Lo que una ingesta puede escribir: los campos libres se aplican; los bloqueados que llegan con otro
 * valor quedan como discrepancia (los iguales no generan nada).
 */
export function respectLocks<T extends Record<string, unknown>>(current: Record<string, unknown>, incoming: T, locked: string[] | null | undefined): Split<T> {
  const lock = new Set(locked ?? []);
  const apply: Partial<T> = {};
  const discrepancies: Split<T>["discrepancies"] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (!lock.has(k)) { (apply as Record<string, unknown>)[k] = v; continue; }
    if (norm(current[k]) !== norm(v) && norm(v) !== null) discrepancies.push({ field: k, current: norm(current[k]), incoming: norm(v) });
  }
  return { apply, discrepancies };
}
