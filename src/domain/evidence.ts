// Evidencia: frescura y agrupación para "qué sabemos". Reglas puras (docs/04-modelo-canonico.md §3).
import { freshnessDays, type evidenceType } from "./catalogs";

type EvidenceType = (typeof evidenceType.values)[number];

/** Días de frescura por tipo: los del workspace (settings.freshness_days) pisan el default de 30. */
export function freshnessFor(settings: unknown): Partial<Record<EvidenceType, number>> {
  const raw = (settings as { freshness_days?: Record<string, unknown> } | null)?.freshness_days ?? {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number" && v > 0 && v <= 3650)) as Partial<Record<EvidenceType, number>>;
}

/** Fecha (AAAA-MM-DD) a partir de la cual conviene revalidar, según el tipo de evidencia. */
export function revalidateAfter(observedAt: string, type: EvidenceType, overrides: Partial<Record<EvidenceType, number>> = {}): string {
  const d = new Date(observedAt);
  d.setUTCDate(d.getUTCDate() + (overrides[type] ?? freshnessDays[type]));
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
