import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { Card, CardSection, candidateState, mergeSection, sanitizeCard, type Lane, type PartyRole, type Section } from "@/domain/candidate";

// Candidato = oportunidad en madurez "candidato": hay evidencia suficiente para profundizar. Puede nacer de
// una empresa, un activo, hallazgos o una brecha de mercado (greenfield sin empresa). La aprobación sigue
// siendo la de siempre (decisión registrada + hallazgo aprobado); "validada" la exige la base.

type Db = SupabaseClient<Database>;
type Route = Database["public"]["Tables"]["opportunities"]["Row"]["route"];

export async function createCandidate(
  db: Db,
  o: { workspaceId: string; campaignId: string | null; title: string; thesis?: string | null; lane?: Lane; route?: Route; companyId?: string | null; assetId?: string | null; gap?: string | null; economicUnit?: string | null; findingIds?: string[] },
) {
  const { data, error } = await db
    .from("opportunities")
    .insert({ workspace_id: o.workspaceId, campaign_id: o.campaignId, title: o.title, thesis: o.thesis ?? null, lane: o.lane ?? "a_definir", route: o.route ?? "a_definir", company_id: o.companyId ?? null, asset_id: o.assetId ?? null, gap: o.gap ?? null, economic_unit: o.economicUnit ?? null })
    .select("id")
    .single();
  if (error) throw error;
  if (o.findingIds?.length) {
    const { error: e2 } = await db.from("opportunity_findings").insert(o.findingIds.map((finding_id) => ({ workspace_id: o.workspaceId, opportunity_id: data.id, finding_id })));
    if (e2) throw e2;
  }
  return data.id;
}

/** Completa una sección de la ficha desde la evidencia (sin perder lo anterior). */
export async function setCardSection(db: Db, opportunityId: string, section: Section, next: CardSection) {
  const { data: o, error } = await db.from("opportunities").select("card").eq("id", opportunityId).single();
  if (error) throw error;
  const card = sanitizeCard(mergeSection(Card.parse(o.card ?? {}), section, CardSection.parse(next)));
  const { error: e2 } = await db.from("opportunities").update({ card: card as unknown as NonNullable<Json> }).eq("id", opportunityId);
  if (e2) throw e2;
  return card;
}

/** Quién usa / decide / paga (y operador, competidor…): una empresa, una persona o una etiqueta genérica. */
export async function addParty(db: Db, o: { workspaceId: string; opportunityId: string; role: PartyRole; companyId?: string | null; contactId?: string | null; label?: string | null; evidenceId?: string | null; note?: string | null }) {
  const { error } = await db.from("opportunity_parties").insert({ workspace_id: o.workspaceId, opportunity_id: o.opportunityId, role: o.role, company_id: o.companyId ?? null, contact_id: o.contactId ?? null, label: o.label ?? null, evidence_id: o.evidenceId ?? null, note: o.note ?? null });
  if (error) throw error;
}

/** Lo que sabemos / lo que falta / qué importa / qué preguntar, para mostrar sin la ficha entera. */
export async function candidateView(db: Db, opportunityId: string) {
  const [{ data: o, error }, { data: parties }] = await Promise.all([
    db.from("opportunities").select("id, title, lane, route, maturity, status, economic_unit, gap, card, company_id, asset_id").eq("id", opportunityId).single(),
    db.from("opportunity_parties").select("role, label, company_id, contact_id").eq("opportunity_id", opportunityId),
  ]);
  if (error) throw error;
  return { opportunity: o, parties: parties ?? [], state: candidateState(Card.parse(o.card ?? {}), (parties ?? []) as { role: PartyRole }[], o.economic_unit) };
}
