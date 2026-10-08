import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FieldStop } from "@/domain/field-plan";

type Db = SupabaseClient<Database>;

/** Empresas del CRM que RELEVO conoce: ID del CRM → objetivo de la misión (para la parada de empresa). */
export async function crmCompanies(db: Db, workspaceId: string): Promise<Map<string, { companyId: string; targetId: string | null }>> {
  const { data } = await db.from("external_refs").select("external_id, entity_id, last_values").eq("workspace_id", workspaceId).eq("source_system", "google_sheets").eq("entity_type", "company");
  return new Map((data ?? []).map((r) => [r.external_id.toUpperCase(), { companyId: r.entity_id, targetId: ((r.last_values as { _ids?: { target?: string } } | null)?._ids?.target ?? null) }]));
}

/**
 * Las paradas que cambiaron en el CRM quedan en la agenda de la misión: una jornada por día (la misma que
 * usa la agenda de RELEVO) y la parada identificada por su fila del CRM. No cambia el estado de una parada
 * que ya existe (lo que pasó en el campo lo registra una persona), sí su clasificación y su contenido.
 */
export async function applyStops(db: Db, o: { workspaceId: string; missionId: string; stops: FieldStop[]; companies: Map<string, { companyId: string; targetId: string | null }> }) {
  const res = { creadas: 0, actualizadas: 0, sinFecha: 0, porClase: {} as Record<string, number> };
  const plans = new Map<string, string>();
  const { data: existingPlans } = await db.from("visit_plans").select("id, planned_on").eq("workspace_id", o.workspaceId).eq("campaign_id", o.missionId).order("created_at");
  for (const p of existingPlans ?? []) if (!plans.has(p.planned_on)) plans.set(p.planned_on, p.id);
  const planIds = [...new Set(plans.values())];
  const refs = o.stops.map((s) => s.ref);
  const { data: existing } = planIds.length && refs.length ? await db.from("visit_stops").select("id, external_ref").in("plan_id", planIds).in("external_ref", refs) : { data: [] };
  const byRef = new Map((existing ?? []).map((s) => [s.external_ref!, s.id]));

  for (const s of o.stops) {
    if (!s.day) {
      res.sinFecha++;
      continue;
    }
    let planId = plans.get(s.day);
    if (!planId) {
      const { data: p, error } = await db.from("visit_plans").insert({ workspace_id: o.workspaceId, campaign_id: o.missionId, title: `Agenda ${s.day}`, planned_on: s.day }).select("id").single();
      if (error) throw error;
      planId = p.id;
      plans.set(s.day, planId);
    }
    const company = s.companyRef ? o.companies.get(s.companyRef) : undefined;
    // Una empresa del CRM sin objetivo en la misión no puede ser parada de empresa: queda como actividad libre
    // con su nombre (no se crea el objetivo para completar el vínculo).
    const asCompany = s.cls === "empresa" && !!company?.targetId;
    const row = {
      plan_id: planId,
      kind: asCompany ? ("empresa" as const) : s.kind === "empresa" ? ("libre" as const) : s.kind,
      target_id: asCompany ? company!.targetId : null,
      label: s.label,
      position: s.position,
      time_slot: s.timeSlot,
      objective: s.objective,
      key_question: s.keyQuestion,
      outcome: s.outcome,
      notes: s.notes,
      stop_class: s.cls,
      crm_status: s.crmStatus,
      external_ref: s.ref,
    };
    const id = byRef.get(s.ref);
    if (id) {
      const { error } = await db.from("visit_stops").update(row).eq("id", id);
      if (error) throw error;
      res.actualizadas++;
    } else {
      const { error } = await db.from("visit_stops").insert({ ...row, workspace_id: o.workspaceId, status: "programada" });
      if (error) throw error;
      res.creadas++;
    }
    res.porClase[s.cls] = (res.porClase[s.cls] ?? 0) + 1;
  }
  return res;
}
