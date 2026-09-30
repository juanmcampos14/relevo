// Corte del CRM de Sheets: hasta la fecha acordada el Sheet sigue siendo fuente operativa activa.
// Antes del corte, una reconciliación completa (lote sin filtro, aplicado, sin nada pendiente).
// Después, RELEVO es la fuente de verdad y el Sheet queda como respaldo: no se vuelve a importar.
export type Cutover = {
  status: "activo" | "cerrado";
  cutoff_on: string | null;
  closed_at: string | null;
  closed_by: string | null;
  reconciliation_batch_id: string | null;
  history: { at: string; by: string; action: "fecha" | "corte" | "reapertura"; note: string }[];
};

export function readCutover(settings: unknown): Cutover {
  const c = ((settings as Record<string, unknown> | null)?.sheet_cutover ?? {}) as Partial<Cutover>;
  return {
    status: c.status === "cerrado" ? "cerrado" : "activo",
    cutoff_on: c.cutoff_on ?? null,
    closed_at: c.closed_at ?? null,
    closed_by: c.closed_by ?? null,
    reconciliation_batch_id: c.reconciliation_batch_id ?? null,
    history: Array.isArray(c.history) ? c.history : [],
  };
}

/** Lote que sirve como reconciliación final: completo (sin filtro), aplicado y hecho desde la fecha de corte. */
export function reconciliationBatch(
  batches: { id: string; status: string; created_at: string; summary: unknown }[],
  cutoffOn: string | null,
): { id: string } | null {
  if (!cutoffOn) return null;
  const since = `${cutoffOn}T00:00:00-03:00`;
  const ok = batches
    .filter((b) => b.status === "aplicado" && !((b.summary as { filtro?: unknown } | null)?.filtro) && Date.parse(b.created_at) >= Date.parse(since))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return ok[0] ? { id: ok[0].id } : null;
}
