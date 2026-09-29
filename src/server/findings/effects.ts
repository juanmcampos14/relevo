import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { evidenceEffect, type Effect, type EvidenceLink } from "@/domain/readiness";

type Db = SupabaseClient<Database>;
type P = { id: string; kind: string; status: string; payload: Record<string, unknown>; result_id: string | null };

export type CaptureEffects = {
  /** Lo que ya cambió (evidencia aceptada). */
  applied: Effect[];
  /** Lo que cambiaría si se acepta lo pendiente. */
  predicted: Effect[];
  newFindings: { statement: string; accepted: boolean; id: string | null }[];
  /** Hay evidencia aceptada pero ningún finding relacionado. */
  noRelation: boolean;
};

const decided = (p?: P) => !!p && (p.status === "aceptada" || p.status === "editada");

/** E1 — ¿qué cambió con esta captura? (y qué cambiaría si aceptás lo pendiente). */
export async function captureEffects(db: Db, captureId: string, today: string): Promise<CaptureEffects> {
  const { data } = await db.from("proposals").select("id, kind, status, payload, result_id").eq("capture_id", captureId).order("position");
  const props = (data ?? []) as P[];
  const byKey = new Map(props.filter((p) => p.payload.key).map((p) => [String(p.payload.key), p]));
  const company = props.find((p) => p.kind === "company");
  const acceptedEvidence = props.filter((p) => p.kind === "evidence" && decided(p) && p.result_id).map((p) => p.result_id!);

  // Hipotéticos: evidencia pendiente relacionada con findings existentes o con un finding "misma hipótesis".
  type Hyp = { findingId: string; link: EvidenceLink };
  const hyp: Hyp[] = [];
  const hypLink = (evId: string, stance: EvidenceLink["stance"]): EvidenceLink => ({
    id: evId, stance, verification_status: "unverified", revalidate_after: null,
    company_id: decided(company) ? company!.result_id : null, stated_by_contact_id: null, capture_id: captureId, visit_id: null, source_id: null,
  });
  for (const p of props.filter((x) => x.kind === "evidence" && x.status === "propuesta")) {
    for (const r of (p.payload.related_findings as { finding_id: string; stance: EvidenceLink["stance"] }[] | undefined) ?? []) hyp.push({ findingId: r.finding_id, link: hypLink(p.id, r.stance) });
  }
  for (const f of props.filter((x) => x.kind === "finding" && x.status === "propuesta" && typeof x.payload.link_to === "string")) {
    for (const [keys, stance] of [[f.payload.supports, "supports"], [f.payload.contradicts, "contradicts"]] as const) {
      for (const k of (keys as string[] | undefined) ?? []) {
        const e = byKey.get(k);
        if (e && e.status !== "rechazada") hyp.push({ findingId: String(f.payload.link_to), link: hypLink(e.result_id ?? e.id, stance) });
      }
    }
  }

  const { data: linked } = acceptedEvidence.length ? await db.from("finding_evidence").select("finding_id").in("evidence_id", acceptedEvidence) : { data: [] };
  const findingIds = [...new Set([...(linked ?? []).map((l) => l.finding_id), ...hyp.map((h) => h.findingId)])];
  const { data: findings } = findingIds.length
    ? await db.from("findings").select("id, statement, finding_evidence(stance, evidence(id, verification_status, revalidate_after, company_id, stated_by_contact_id, capture_id, visit_id, source_id))").in("id", findingIds)
    : { data: [] };
  const real = (findings ?? []).map((f) => ({
    id: f.id,
    statement: f.statement,
    links: f.finding_evidence.filter((x) => x.evidence).map((x) => ({ ...x.evidence!, stance: x.stance as EvidenceLink["stance"] })),
  }));

  const applied = evidenceEffect(real, new Set(acceptedEvidence), today);
  const withHyp = real.map((f) => ({ ...f, links: [...f.links, ...hyp.filter((h) => h.findingId === f.id && !f.links.some((l) => l.id === h.link.id)).map((h) => h.link)] }));
  const predicted = evidenceEffect(withHyp, new Set(hyp.map((h) => h.link.id)), today);

  const newFindings = props
    .filter((p) => p.kind === "finding" && p.status !== "rechazada" && !(p.status === "propuesta" && p.payload.link_to) && !(decided(p) && p.result_id !== p.id))
    .map((p) => ({ statement: String(p.payload.statement), accepted: decided(p), id: decided(p) ? p.result_id : null }));

  return { applied, predicted, newFindings, noRelation: acceptedEvidence.length > 0 && applied.length === 0 && newFindings.length === 0 };
}

/** E3 en HOY — qué cambió en lo que sabemos desde una fecha: efecto de la evidencia nueva + hipótesis nuevas. */
export async function changesSince(db: Db, sinceIso: string, today: string): Promise<{ effects: Effect[]; newFindings: { id: string; statement: string }[] }> {
  const [{ data: recent }, { data: created }] = await Promise.all([
    db.from("finding_evidence").select("finding_id, evidence_id").gte("created_at", sinceIso),
    db.from("findings").select("id, statement").gte("created_at", sinceIso).neq("review_status", "rechazado"),
  ]);
  const newIds = new Set((created ?? []).map((f) => f.id));
  const ids = [...new Set((recent ?? []).map((r) => r.finding_id))].filter((id) => !newIds.has(id));
  if (!ids.length) return { effects: [], newFindings: created ?? [] };
  const { data: findings } = await db
    .from("findings")
    .select("id, statement, finding_evidence(stance, evidence(id, verification_status, revalidate_after, company_id, stated_by_contact_id, capture_id, visit_id, source_id))")
    .in("id", ids);
  const effects = evidenceEffect(
    (findings ?? []).map((f) => ({ id: f.id, statement: f.statement, links: f.finding_evidence.filter((x) => x.evidence).map((x) => ({ ...x.evidence!, stance: x.stance as EvidenceLink["stance"] })) })),
    new Set((recent ?? []).map((r) => r.evidence_id)),
    today,
  );
  return { effects, newFindings: created ?? [] };
}
