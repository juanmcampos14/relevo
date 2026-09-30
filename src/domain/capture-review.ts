// Revisión ejecutiva de una captura: normalidad → una aprobación; incertidumbre → se muestra antes.
// Una misma función decide qué muestra "Esto requiere tu decisión" y qué deja afuera "Aprobar propuesta".

export type ReviewProposal = {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  matches?: { type: string; id: string; name: string; reason: string }[] | null;
};

/** Orden de escritura: lo que otros necesitan primero (la persona antes de lo que dijo). */
export const APPROVAL_ORDER = ["company", "asset", "person", "evidence", "finding", "next_action"];

/** Propuestas pendientes que requieren una decisión humana, con el porqué. */
export function captureExceptions(proposals: ReviewProposal[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of proposals) {
    if (p.status !== "propuesta") continue;
    const linked = typeof p.payload.link_to === "string" && p.payload.link_to;
    const matches = p.matches ?? [];
    if (typeof p.payload.resolves === "string" && p.payload.resolves) {
      out.set(p.id, "Identifica a alguien que antes estaba sin identificar: confirmá que es la misma.");
    } else if (p.kind === "company" && p.payload.identified !== false && !linked && matches.length) {
      out.set(p.id, `Puede ser una empresa que ya está en RELEVO (${matches[0].name}).`);
    } else if (p.kind === "person" && !linked && matches.length) {
      out.set(p.id, `Puede ser una persona que ya está en RELEVO (${matches[0].name}).`);
    } else if (p.kind === "finding" && !linked && matches.length) {
      out.set(p.id, `Se parece a una hipótesis que ya existe: ¿es la misma?`);
    } else if (p.kind === "finding" && linked && typeof p.payload.refined_statement === "string" && p.payload.refined_statement) {
      out.set(p.id, "Reformula una hipótesis existente: confirmá el nuevo enunciado.");
    }
  }
  return out;
}

export function approvalOrder<T extends ReviewProposal>(proposals: T[]): T[] {
  return [...proposals].sort((a, b) => APPROVAL_ORDER.indexOf(a.kind) - APPROVAL_ORDER.indexOf(b.kind));
}
