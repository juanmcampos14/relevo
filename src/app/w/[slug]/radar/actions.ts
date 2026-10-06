"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { addCriterion, type WatchConfig } from "@/server/mission/watch";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncWorkspaceSheet } from "@/server/sheet/run";

// Triage de lo que entra: IMPORTA (cambia algo: queda su próxima acción) · SEGUIR (pedido de aviso) ·
// CONTEXTO (entendido, sale del trabajo activo y queda en memoria, sin acción) · DESCARTAR (no vuelve salvo
// cambio material). La única "próxima acción" es la tarea: Importa la crea si hay un paso concreto.
const STATUS = { importa: "incorporada", seguir: "seguida", contexto: "procesada", descartar: "descartada" } as const;
export type TriageChoice = keyof typeof STATUS;

export async function triageSignal(slug: string, signalId: string, choice: TriageChoice): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data: s } = await supabase.from("brief_signals").select("headline, suggested_action, campaign_ids, finding_ids").eq("id", signalId).maybeSingle();
  if (!s) return { message: "No encontré la señal." };
  const { error } = await supabase.from("brief_signals").update({ status: STATUS[choice], triaged_by: ctx.user.id, triaged_at: new Date().toISOString(), material: choice === "importa" ? true : choice === "descartar" ? false : undefined }).eq("id", signalId);
  if (error) return { message: dbErrorMessage(error) };
  const mission = s.campaign_ids[0] ?? null;
  if (choice === "importa" && s.suggested_action) {
    const { count } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("signal_id", signalId);
    if (!count) await supabase.from("tasks").insert({ workspace_id: ctx.workspace.id, campaign_id: mission, signal_id: signalId, title: s.suggested_action.slice(0, 300), kind: "Seguimiento", finding_id: s.finding_ids[0] ?? null, assignee_id: ctx.user.id });
  }
  if (choice === "seguir" && mission) {
    const { data: m } = await supabase.from("campaigns").select("watch").eq("id", mission).single();
    await supabase.from("campaigns").update({ watch: addCriterion((m?.watch as WatchConfig | null) ?? null, { text: s.headline.slice(0, 200), by: ctx.user.id }) as unknown as Json }).eq("id", mission);
  }
  revalidatePath(`/w/${slug}/radar`);
  return { ok: true, message: choice === "importa" ? "Importa: quedó su próxima acción." : choice === "seguir" ? "Lo sigo: te aviso si cambia." : choice === "contexto" ? "Guardado como contexto: no requiere acción." : "Descartado." };
}

const TABLE = { company: "companies", contact: "contacts", establishment: "establishments", asset: "assets" } as const;

/** "Encontré información diferente": la persona decide. Aceptar aplica el dato nuevo (y lo deja bloqueado); mantener lo descarta. */
export async function decideDiscrepancy(slug: string, id: string, verdict: "aceptada" | "descartada"): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data: d } = await supabase.from("source_discrepancies").select("entity_type, entity_id, field, incoming_value, status").eq("id", id).maybeSingle();
  if (!d || d.status !== "pendiente") return { message: "Ya estaba decidida." };
  if (verdict === "aceptada" && d.entity_type in TABLE) {
    const { error } = await supabase.from(TABLE[d.entity_type as keyof typeof TABLE]).update({ [d.field]: d.incoming_value } as never).eq("id", d.entity_id);
    if (error) return { message: dbErrorMessage(error) };
  }
  await supabase.from("source_discrepancies").update({ status: verdict, decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/w/${slug}/radar`);
  return { ok: true, message: verdict === "aceptada" ? "Actualizado con el dato nuevo." : "Se mantiene lo que había." };
}

/** Sincronizar el Sheet operativo ahora (además de las corridas de cada hora). */
export async function syncSheetNow(slug: string): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const r = await syncWorkspaceSheet(createAdminClient(), ctx.workspace.id, ctx.workspace.settings, "manual").catch((e) => ({ status: "error" as const, error: (e as Error).message }));
  revalidatePath(`/w/${slug}/radar`);
  if (r.status === "sin_cambios") return { ok: true, message: "El Sheet no cambió desde la última sincronización." };
  if (r.status === "procesado") return { ok: true, message: "Listo: procesé lo que cambió en el Sheet." };
  return { message: r.error ?? "No se pudo sincronizar." };
}
