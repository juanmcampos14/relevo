import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Próxima acción como primitiva: casi cualquier objeto responde "¿qué hacemos después?". La
// implementación canónica es la tarea (responsable, fecha opcional, estado, vínculo); no hay otro sistema
// de tareas. Lo que viene de antes en campaign_targets.next_action / opportunities.next_action se sigue
// leyendo como respaldo cuando no hay una tarea abierta.

type Db = SupabaseClient<Database>;
export type NextActionOf = { company: string } | { contact: string } | { asset: string } | { opportunity: string } | { stop: string } | { finding: string };
export type NextAction = { source: "task"; id: string; title: string; due_on: string | null; assignee_id: string | null; status: string } | { source: "legacy"; title: string; due_on: string | null };

const OPEN = ["todo", "in_progress", "blocked"];

/** La próxima acción de un objeto: la tarea abierta más próxima (sin fecha, al final); si no hay, el texto anterior. */
export async function nextAction(db: Db, of: NextActionOf): Promise<NextAction | null> {
  let q = db.from("tasks").select("id, title, due_on, assignee_id, status").in("status", OPEN);
  if ("company" in of) {
    const { data: targets } = await db.from("campaign_targets").select("id").eq("company_id", of.company);
    const ids = (targets ?? []).map((t) => t.id);
    const { data: people } = await db.from("contact_links").select("contact_id").eq("company_id", of.company).is("valid_until", null);
    const contacts = (people ?? []).map((p) => p.contact_id);
    const ors = [ids.length ? `target_id.in.(${ids.join(",")})` : null, contacts.length ? `contact_id.in.(${contacts.join(",")})` : null].filter(Boolean);
    if (!ors.length) return legacy(db, of);
    q = q.or(ors.join(","));
  } else if ("contact" in of) q = q.eq("contact_id", of.contact);
  else if ("asset" in of) q = q.eq("asset_id", of.asset);
  else if ("opportunity" in of) q = q.eq("opportunity_id", of.opportunity);
  else if ("stop" in of) q = q.eq("stop_id", of.stop);
  else q = q.eq("finding_id", of.finding);
  const { data } = await q.order("due_on", { ascending: true, nullsFirst: false }).order("created_at").limit(1);
  const t = data?.[0];
  return t ? { source: "task", id: t.id, title: t.title, due_on: t.due_on, assignee_id: t.assignee_id, status: t.status } : legacy(db, of);
}

async function legacy(db: Db, of: NextActionOf): Promise<NextAction | null> {
  if ("company" in of) {
    const { data } = await db.from("campaign_targets").select("next_action, next_action_due").eq("company_id", of.company).not("next_action", "is", null).order("next_action_due", { nullsFirst: false }).limit(1);
    return data?.[0]?.next_action ? { source: "legacy", title: data[0].next_action, due_on: data[0].next_action_due } : null;
  }
  if ("opportunity" in of) {
    const { data } = await db.from("opportunities").select("next_action, next_action_due").eq("id", of.opportunity).maybeSingle();
    return data?.next_action ? { source: "legacy", title: data.next_action, due_on: data.next_action_due } : null;
  }
  return null;
}
