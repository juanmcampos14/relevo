// Comparación en tres sentidos: base (lo último importado) · Sheet (lo que llega) · RELEVO (lo actual).
// Importar no es sincronizar: solo cambia lo que el Sheet cambió y RELEVO no tocó; si ambos
// cambiaron el mismo campo, es un conflicto que decide una persona (aprobado por Tano el 29/09).

export type FieldChange = { field: string; from: unknown; to: unknown };
export type FieldConflict = { field: string; base: unknown; sheet: unknown; relevo: unknown };
export type DiffResult =
  | { kind: "nuevo" }
  | { kind: "sin_cambios"; relevoEdited: boolean }
  | { kind: "cambios"; updates: FieldChange[]; conflicts: FieldConflict[]; relevoEdited: boolean };

/** null, "" y espacios son "vacío"; el resto se compara por valor. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return JSON.stringify(v);
}
const same = (a: unknown, b: unknown) => norm(a) === norm(b);

export function threeWay(
  incoming: Record<string, unknown>,
  base: Record<string, unknown> | null,
  current: Record<string, unknown> | null,
  fields: readonly string[],
): DiffResult {
  if (!base || !current) return { kind: "nuevo" };
  const updates: FieldChange[] = [];
  const conflicts: FieldConflict[] = [];
  let relevoEdited = false;
  for (const f of fields) {
    const sheetChanged = !same(incoming[f], base[f]);
    const relevoChanged = !same(current[f], base[f]);
    if (relevoChanged) relevoEdited = true;
    if (!sheetChanged) continue;
    if (!relevoChanged) updates.push({ field: f, from: current[f], to: incoming[f] });
    else if (!same(incoming[f], current[f])) conflicts.push({ field: f, base: base[f], sheet: incoming[f], relevo: current[f] });
  }
  if (!updates.length && !conflicts.length) return { kind: "sin_cambios", relevoEdited };
  return { kind: "cambios", updates, conflicts, relevoEdited };
}
