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

const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const STRONG = /^(mismo cuit|mismo dominio|mismo telefono|mismo nombre|mismo nombre y misma empresa)$/;

/**
 * ¿Es claramente alguien que ya está en RELEVO? Un solo candidato y, o una coincidencia fuerte (mismo CUIT,
 * dominio, teléfono, nombre normalizado), o exactamente el mismo nombre. Entonces se vincula solo (auditado);
 * si hay dos posibles o el nombre no es el mismo, se pregunta.
 */
export function clearMatch(p: ReviewProposal): string | null {
  if (p.status !== "propuesta" || (p.kind !== "company" && p.kind !== "person")) return null;
  if (typeof p.payload.link_to === "string" && p.payload.link_to) return null;
  const matches = p.matches ?? [];
  if (matches.length !== 1) return null;
  const m = matches[0];
  if (/^solo coincide el nombre/.test(m.reason)) return null;
  const name = typeof p.payload.name === "string" ? p.payload.name : "";
  return STRONG.test(m.reason) || (name && fold(name) === fold(m.name)) ? m.id : null;
}
