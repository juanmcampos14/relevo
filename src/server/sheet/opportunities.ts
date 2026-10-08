import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { CrmOpportunity } from "@/domain/crm-opportunity";

type Db = SupabaseClient<Database>;

/**
 * Las oportunidades que cambiaron en el CRM quedan en la misión, referidas por su ID (OP-###), con su
 * empresa (solo si el ID de EMPRESAS existe en RELEVO) y la ficha del CRM tal cual. El CRM manda: se
 * reemplazan los campos que vienen de él; lo que RELEVO agregue a la ficha fuera de "crm" se conserva.
 */
export async function applyOpportunities(db: Db, o: { workspaceId: string; missionId: string; opportunities: CrmOpportunity[]; companies: Map<string, { companyId: string }> }) {
  const res = { creadas: 0, actualizadas: 0, sinEmpresa: [] as string[] };
  const { data: refs } = await db.from("external_refs").select("id, external_id, entity_id").eq("workspace_id", o.workspaceId).eq("source_system", "google_sheets").eq("entity_type", "opportunity");
  const byExt = new Map((refs ?? []).map((r) => [r.external_id.toUpperCase(), r]));
  for (const op of o.opportunities) {
    const company = op.companyRef ? o.companies.get(op.companyRef) : undefined;
    if (op.companyRef && !company) res.sinEmpresa.push(`${op.externalId} → ${op.companyRef}`);
    const fields = {
      title: op.title,
      thesis: op.thesis,
      company_id: company?.companyId ?? null,
      campaign_id: o.missionId,
      next_action: op.nextAction,
      next_action_due: op.nextActionDue,
    };
    const ref = byExt.get(op.externalId);
    if (ref) {
      const { data: cur } = await db.from("opportunities").select("card").eq("id", ref.entity_id).single();
      const card = { ...((cur?.card as Record<string, unknown> | null) ?? {}), crm_id: op.externalId, crm: op.crm, decision: op.decision };
      const { error } = await db.from("opportunities").update({ ...fields, card: card as unknown as NonNullable<Json> }).eq("id", ref.entity_id);
      if (error) throw error;
      await db.from("external_refs").update({ last_values: op.crm as unknown as NonNullable<Json>, last_imported_at: new Date().toISOString() }).eq("id", ref.id);
      res.actualizadas++;
    } else {
      const { data: created, error } = await db.from("opportunities").insert({ workspace_id: o.workspaceId, ...fields, card: { crm_id: op.externalId, crm: op.crm, decision: op.decision } as unknown as NonNullable<Json>, owner_id: null, created_by: null }).select("id").single();
      if (error) throw error;
      const { error: e2 } = await db.from("external_refs").insert({ workspace_id: o.workspaceId, source_system: "google_sheets", entity_type: "opportunity", external_id: op.externalId, entity_id: created.id, sheet: "OPORTUNIDADES", last_values: op.crm as unknown as NonNullable<Json> });
      if (e2) throw e2;
      byExt.set(op.externalId, { id: "", external_id: op.externalId, entity_id: created.id });
      res.creadas++;
    }
  }
  return res;
}

/**
 * Actividades del CRM con "Oportunidad ID": quedan vinculadas a su oportunidad (en cada pasada, así una
 * actividad nueva o una oportunidad nueva se encuentran sin importar el orden en que llegaron). No desvincula
 * nada: un vínculo hecho en RELEVO se conserva.
 */
export async function linkOpportunityTasks(db: Db, workspaceId: string): Promise<number> {
  const [{ data: opps }, { data: tasks }] = await Promise.all([
    db.from("external_refs").select("external_id, entity_id").eq("workspace_id", workspaceId).eq("source_system", "google_sheets").eq("entity_type", "opportunity"),
    db.from("external_refs").select("entity_id, last_values").eq("workspace_id", workspaceId).eq("source_system", "google_sheets").eq("entity_type", "task"),
  ]);
  const opp = new Map((opps ?? []).map((r) => [r.external_id.toUpperCase(), r.entity_id]));
  let linked = 0;
  for (const t of tasks ?? []) {
    const ref = ((t.last_values as { opportunity_ref?: string | null } | null)?.opportunity_ref ?? "").toUpperCase();
    const target = ref ? opp.get(ref) : undefined;
    if (!target) continue;
    const { data } = await db.from("tasks").update({ opportunity_id: target }).eq("id", t.entity_id).or(`opportunity_id.is.null,opportunity_id.neq.${target}`).select("id");
    linked += data?.length ?? 0;
  }
  return linked;
}
