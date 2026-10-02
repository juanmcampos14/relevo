import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { companyName } from "@/server/entities";

// Correcciones conversacionales de relaciones: "Nicolás ya no trabaja en Pecom", "ahora está en Vista como
// gerente de compras". El Brain no borra historia: actualiza vigencia. La relación queda como anterior (con
// fecha, quién lo validó y la evidencia), se deja de recomendar a esa persona para esa empresa y se abre lo
// que sigue (encontrar a la persona nueva). Todo queda auditado y se puede deshacer.

type Db = SupabaseClient<Database>;
const REF = (t: string) => new RegExp(`^${t}:[0-9a-f-]{36}$`);

export const RelationshipInput = z.object({
  change: z.enum(["ya_no_esta", "ahora_esta"]),
  contact_ref: z.string().regex(REF("contact")),
  company_ref: z.string().regex(REF("company")),
  role: z.string().trim().max(160).optional(),
  since: z.iso.date().optional(),
  note: z.string().trim().max(600).optional(),
});
export type RelationshipChange = z.infer<typeof RelationshipInput>;

export type RelationshipEffects = {
  link: { id: string; before: { valid_until: string | null; ended_note: string | null; ended_evidence_id: string | null; role_title: string | null } | null; created: boolean };
  contact_role_before: string | null;
  evidence_id: string | null;
  closed_tasks: { id: string; status: string; completed_at: string | null }[];
  created_task: string | null;
};

const OUTREACH = /borrador|contactar|escrib|solicitar reuni|primer contacto|revisar contacto|pedir intro|seguimiento|respondi/i;

export async function applyRelationship(db: Db, ctx: { workspaceId: string; userId: string; userName: string | null; campaignId: string | null; now?: Date }, c: RelationshipChange): Promise<{ summary: string; effects: RelationshipEffects }> {
  const now = ctx.now ?? new Date();
  const day = c.since ?? now.toISOString().slice(0, 10);
  const contactId = c.contact_ref.split(":")[1];
  const companyId = c.company_ref.split(":")[1];
  const [{ data: person }, { data: company }] = await Promise.all([
    db.from("contacts").select("full_name, role_title").eq("id", contactId).maybeSingle(),
    db.from("companies").select("trade_name, legal_name").eq("id", companyId).maybeSingle(),
  ]);
  if (!person || !company) throw new Error("No encontré a la persona o a la empresa.");
  const org = companyName(company);
  const who = ctx.userName ?? "el equipo";
  const effects: RelationshipEffects = { link: { id: "", before: null, created: false }, contact_role_before: person.role_title, evidence_id: null, closed_tasks: [], created_task: null };

  const { data: link } = await db.from("contact_links").select("id, valid_until, ended_note, ended_evidence_id, role_title").eq("contact_id", contactId).eq("company_id", companyId).maybeSingle();
  // La evidencia del cambio: quién lo validó y cuándo (no es un dato de la web: es una observación del equipo).
  const statement = c.change === "ya_no_esta"
    ? `${person.full_name} ya no trabaja en ${org}${c.since ? ` (desde ${c.since})` : ""}. Lo validó ${who} el ${now.toISOString().slice(0, 10)}${c.note ? `: ${c.note}` : "."}`
    : `${person.full_name} trabaja ahora en ${org}${c.role ? ` como ${c.role}` : ""}. Lo validó ${who} el ${now.toISOString().slice(0, 10)}${c.note ? `: ${c.note}` : "."}`;
  const { data: ev, error: e1 } = await db
    .from("evidence")
    .insert({ workspace_id: ctx.workspaceId, statement, evidence_type: "contacto", origin_kind: "conversation", verification_status: "unverified", observed_at: now.toISOString(), company_id: companyId, contact_id: contactId, campaign_id: ctx.campaignId })
    .select("id")
    .single();
  if (e1) throw e1;
  effects.evidence_id = ev.id;

  if (c.change === "ya_no_esta") {
    if (!link) throw new Error(`${person.full_name} no figuraba vinculado a ${org}.`);
    effects.link = { id: link.id, before: { valid_until: link.valid_until, ended_note: link.ended_note, ended_evidence_id: link.ended_evidence_id, role_title: link.role_title }, created: false };
    const role = link.role_title ?? person.role_title;
    const { error } = await db.from("contact_links").update({ valid_until: day, ended_note: c.note ?? `Lo validó ${who}`, ended_evidence_id: ev.id, role_title: role }).eq("id", link.id);
    if (error) throw error;
    // Su cargo ya no es ese: queda como antecedente.
    if (person.role_title && !/^antes:/i.test(person.role_title)) await db.from("contacts").update({ role_title: `Antes: ${person.role_title}`.slice(0, 200) }).eq("id", contactId);
    // Lo pendiente con esa persona deja de tener sentido.
    const { data: open } = await db.from("tasks").select("id, title, status, completed_at").eq("contact_id", contactId).neq("status", "done");
    for (const t of (open ?? []).filter((x) => OUTREACH.test(x.title))) {
      await db.from("tasks").update({ status: "done", completed_at: now.toISOString() }).eq("id", t.id);
      effects.closed_tasks.push({ id: t.id, status: t.status, completed_at: t.completed_at });
    }
    // Lo que sigue: encontrar a la persona nueva en esa empresa (ligado al objetivo de la misión si existe).
    const { data: target } = ctx.campaignId ? await db.from("campaign_targets").select("id").eq("campaign_id", ctx.campaignId).eq("company_id", companyId).maybeSingle() : { data: null };
    const { data: t, error: e2 } = await db
      .from("tasks")
      .insert({ workspace_id: ctx.workspaceId, title: `Encontrar a la persona que reemplaza a ${person.full_name} en ${org}`, kind: "Contacto", status: "todo", target_id: target?.id ?? null, campaign_id: ctx.campaignId, assignee_id: ctx.userId, due_on: now.toISOString().slice(0, 10), description: `${person.full_name} ya no está en ${org} (${role ?? "sin cargo registrado"}).` })
      .select("id")
      .single();
    if (e2) throw e2;
    effects.created_task = t.id;
    return { summary: `${person.full_name} ya no está en ${org}: quedó como relación anterior y no lo vuelvo a recomendar para ${org}. Queda pendiente encontrar a quien lo reemplaza.`, effects };
  }

  // Ahora está: relación vigente (nueva o reactivada) con su cargo.
  if (link) {
    effects.link = { id: link.id, before: { valid_until: link.valid_until, ended_note: link.ended_note, ended_evidence_id: link.ended_evidence_id, role_title: link.role_title }, created: false };
    const { error } = await db.from("contact_links").update({ valid_until: null, ended_note: null, ended_evidence_id: null, role_title: c.role ?? link.role_title }).eq("id", link.id);
    if (error) throw error;
  } else {
    const { data: nl, error } = await db.from("contact_links").insert({ workspace_id: ctx.workspaceId, contact_id: contactId, company_id: companyId, relation: "empleado", role_title: c.role ?? null }).select("id").single();
    if (error) throw error;
    effects.link = { id: nl.id, before: null, created: true };
  }
  if (c.role) await db.from("contacts").update({ role_title: `${c.role} · ${org}`.slice(0, 200) }).eq("id", contactId);
  return { summary: `${person.full_name} quedó en ${org}${c.role ? ` como ${c.role}` : ""}.`, effects };
}

export async function undoRelationship(db: Db, contactId: string, e: RelationshipEffects): Promise<void> {
  if (e.link.created) await db.from("contact_links").delete().eq("id", e.link.id);
  else if (e.link.before) await db.from("contact_links").update(e.link.before).eq("id", e.link.id);
  await db.from("contacts").update({ role_title: e.contact_role_before }).eq("id", contactId);
  if (e.created_task) await db.from("tasks").delete().eq("id", e.created_task);
  for (const t of e.closed_tasks) await db.from("tasks").update({ status: t.status, completed_at: t.completed_at }).eq("id", t.id);
  if (e.evidence_id) await db.from("evidence").delete().eq("id", e.evidence_id);
}

export const relationshipJson = (e: RelationshipEffects) => e as unknown as Json;
