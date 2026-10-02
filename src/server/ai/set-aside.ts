import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// "Sacá ese terreno, no lo vuelvas a mostrar": se descarta en la misión, sin borrar. Una empresa, un activo o
// un lugar quedan como objetivo descartado (con el motivo); una hipótesis, como caso descartado con su revisión.
// La memoria lo conserva (y explica por qué se descartó); la Surface deja de mostrarlo. Se puede deshacer.

type Db = SupabaseClient<Database>;
export type SetAsideEffects =
  | { kind: "target"; id: string; created: boolean; before: { status: string; discard_reason: string | null } | null }
  | { kind: "finding"; id: string; before: { case_status: string } };

const COL = { company: "company_id", asset: "asset_id", establishment: "establishment_id" } as const;

export async function setAside(db: Db, ctx: { workspaceId: string; missionId: string }, ref: string, reason: string): Promise<{ summary: string; effects: SetAsideEffects }> {
  const [type, id] = ref.split(":");
  if (type === "finding") {
    const { data: f } = await db.from("findings").select("statement, case_status").eq("id", id).single();
    if (!f) throw new Error("No encontré esa hipótesis.");
    const { error } = await db.from("findings").update({ case_status: "descartado" }).eq("id", id);
    if (error) throw error;
    await db.from("finding_revisions").insert({ workspace_id: ctx.workspaceId, finding_id: id, kind: "estado", previous_value: f.case_status, new_value: "descartado", reason });
    return { summary: `Descarté «${f.statement}»: ${reason}`, effects: { kind: "finding", id, before: { case_status: f.case_status } } };
  }
  const col = COL[type as keyof typeof COL];
  if (!col) throw new Error("Solo se descartan empresas, activos, lugares o hipótesis.");
  const { data: t } = await db.from("campaign_targets").select("id, status, discard_reason").eq("campaign_id", ctx.missionId).eq(col, id).maybeSingle();
  if (t) {
    const { error } = await db.from("campaign_targets").update({ status: "descartado", discard_reason: reason }).eq("id", t.id);
    if (error) throw error;
    return { summary: `Lo saqué de la misión: ${reason}`, effects: { kind: "target", id: t.id, created: false, before: { status: t.status, discard_reason: t.discard_reason } } };
  }
  const { data: n, error } = await db.from("campaign_targets").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.missionId, [col]: id, status: "descartado", discard_reason: reason } as never).select("id").single();
  if (error) throw error;
  return { summary: `Lo saqué de la misión: ${reason}`, effects: { kind: "target", id: (n as { id: string }).id, created: true, before: null } };
}

export async function undoSetAside(db: Db, workspaceId: string, e: SetAsideEffects): Promise<void> {
  if (e.kind === "finding") {
    await db.from("findings").update({ case_status: e.before.case_status }).eq("id", e.id);
    await db.from("finding_revisions").insert({ workspace_id: workspaceId, finding_id: e.id, kind: "estado", previous_value: "descartado", new_value: e.before.case_status, reason: "Deshecho" });
    return;
  }
  if (e.created) await db.from("campaign_targets").delete().eq("id", e.id);
  else if (e.before) await db.from("campaign_targets").update(e.before).eq("id", e.id);
}
