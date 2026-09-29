// Evidencia: frescura y agrupación para "qué sabemos". Reglas puras (docs/04-modelo-canonico.md §3).
import { freshnessDays, type evidenceType } from "./catalogs";

type EvidenceType = (typeof evidenceType.values)[number];

/** Fecha (AAAA-MM-DD) a partir de la cual conviene revalidar, según el tipo de evidencia. */
export function revalidateAfter(observedAt: string, type: EvidenceType): string {
  const d = new Date(observedAt);
  d.setUTCDate(d.getUTCDate() + freshnessDays[type]);
  return d.toISOString().slice(0, 10);
}

/** Desactualizada: marcada así por una persona, o vencida su fecha de revalidación. */
export function isStale(e: { verification_status: string; revalidate_after: string | null }, today: string): boolean {
  return e.verification_status === "stale" || (!!e.revalidate_after && e.revalidate_after < today);
}

export type KnowledgeGroup = "sabemos" | "creemos" | "en_duda";

/** Qué sabemos (verificado) · qué creemos (sin verificar o parcial) · en duda (contradicho o desactualizado). */
export function knowledgeGroup(e: { verification_status: string; revalidate_after: string | null }, today: string): KnowledgeGroup {
  if (e.verification_status === "contradicted" || isStale(e, today)) return "en_duda";
  if (e.verification_status === "publicly_verified" || e.verification_status === "field_verified") return "sabemos";
  return "creemos";
}
