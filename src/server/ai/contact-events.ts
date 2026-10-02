import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { companyName } from "@/server/entities";

// Lo que la persona dicta y RELEVO aplica solo (interno, reversible, alta confianza): "ya le escribí a…",
// "X confirmó el miércoles 11:30". Queda auditado como borrador ejecutado y se puede deshacer.
// No toca campos que gobierna el Sheet del CRM (estado de relación): el registro vive en tareas y agenda.

type Db = SupabaseClient<Database>;
const REF = (t: string) => new RegExp(`^${t}:[0-9a-f-]{36}$`);

export const ContactEventInput = z
  .object({
    event: z.enum(["mensaje_enviado", "reunion_confirmada"]),
    contact_ref: z.string().regex(REF("contact")).optional(),
    company_ref: z.string().regex(REF("company")).optional(),
    channel: z.string().trim().max(40).optional(),
    date: z.iso.date().optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    place: z.string().trim().max(200).optional(),
    objective: z.string().trim().max(400).optional(),
    note: z.string().trim().max(600).optional(),
    follow_up_on: z.iso.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.contact_ref && !v.company_ref) ctx.addIssue({ code: "custom", message: "Falta a quién: contact_ref o company_ref" });
    if (v.event === "reunion_confirmada" && !v.date) ctx.addIssue({ code: "custom", message: "Una reunión confirmada necesita fecha (date)" });
  });
export type ContactEvent = z.infer<typeof ContactEventInput>;

/** Lo que se creó o cambió, para auditar y deshacer. */
export type EventEffects = {
  closed_tasks: { id: string; status: string; completed_at: string | null }[];
  created_tasks: string[];
  created_stop: string | null;
  created_plan: string | null;
  created_target: string | null;
  calendar_url: string | null;
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Tres días hábiles después de hoy (hora Argentina). */
export function followUpDay(from: Date): string {
  const d = new Date(from.getTime() - 3 * 3_600_000);
  let added = 0;
  while (added < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++;
  }
  return isoDay(d);
}

/** Link de Google Calendar prellenado (sin OAuth). Mismo objeto que después ejecutará la integración real. */
export function calendarLink(e: { title: string; date: string; time?: string; minutes?: number; details?: string; place?: string }): string {
  const compact = (s: string) => s.replace(/[-:]/g, "");
  let dates: string;
  if (e.time) {
    const start = new Date(`${e.date}T${e.time}:00-03:00`);
    const end = new Date(start.getTime() + (e.minutes ?? 60) * 60_000);
    const z = (d: Date) => compact(d.toISOString().slice(0, 19)) + "Z";
    dates = `${z(start)}/${z(end)}`;
  } else {
    const next = new Date(`${e.date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    dates = `${compact(e.date)}/${compact(isoDay(next))}`;
  }
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates, details: e.details ?? "", location: e.place ?? "", ctz: "America/Argentina/Buenos_Aires" });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

const OUTREACH_TASK = /borrador|contactar|escrib|solicitar reuni|primer contacto|revisar contacto|pedir intro/i;

export async function applyContactEvent(db: Db, ctx: { workspaceId: string; userId: string; campaignId: string | null; now?: Date }, e: ContactEvent): Promise<{ summary: string; effects: EventEffects }> {
  const now = ctx.now ?? new Date();
  const contactId = e.contact_ref?.split(":")[1] ?? null;
  let companyId = e.company_ref?.split(":")[1] ?? null;
  const { data: person } = contactId ? await db.from("contacts").select("full_name, contact_links(company_id, companies(id, trade_name, legal_name))").eq("id", contactId).maybeSingle() : { data: null };
  if (contactId && !person) throw new Error("No encontré a esa persona.");
  if (!companyId) companyId = person?.contact_links[0]?.company_id ?? null;
  const { data: company } = companyId ? await db.from("companies").select("id, trade_name, legal_name").eq("id", companyId).maybeSingle() : { data: null };
  const who = [person?.full_name, company ? companyName(company) : null].filter(Boolean).join(" · ");
  const effects: EventEffects = { closed_tasks: [], created_tasks: [], created_stop: null, created_plan: null, created_target: null, calendar_url: null };

  // Objetivo de la misión de esa empresa (para atar la tarea y la agenda a la misión).
  let targetId: string | null = null;
  if (ctx.campaignId && companyId) {
    const { data: t } = await db.from("campaign_targets").select("id").eq("campaign_id", ctx.campaignId).eq("company_id", companyId).maybeSingle();
    targetId = t?.id ?? null;
  }

  if (e.event === "mensaje_enviado") {
    let q = db.from("tasks").select("id, title, status, completed_at").neq("status", "done");
    q = contactId ? q.eq("contact_id", contactId) : q.eq("target_id", targetId ?? "00000000-0000-0000-0000-000000000000");
    const { data: open } = await q;
    for (const t of (open ?? []).filter((x) => OUTREACH_TASK.test(x.title))) {
      const { error } = await db.from("tasks").update({ status: "done", completed_at: now.toISOString() }).eq("id", t.id);
      if (error) throw error;
      effects.closed_tasks.push({ id: t.id, status: t.status, completed_at: t.completed_at });
    }
    const due = e.follow_up_on ?? followUpDay(now);
    const { data: t, error } = await db
      .from("tasks")
      .insert({ workspace_id: ctx.workspaceId, title: `¿Respondió ${person?.full_name ?? (company ? companyName(company) : "")}? Si no, volver a escribir`, kind: "Seguimiento", channel: e.channel ?? null, due_on: due, status: "todo", contact_id: contactId, target_id: targetId, campaign_id: ctx.campaignId, assignee_id: ctx.userId, description: [e.channel ? `Primer contacto enviado por ${e.channel} el ${isoDay(now)}.` : `Primer contacto enviado el ${isoDay(now)}.`, e.note].filter(Boolean).join(" ") })
      .select("id")
      .single();
    if (error) throw error;
    effects.created_tasks.push(t.id);
    return { summary: `Contacto enviado a ${who}${e.channel ? ` por ${e.channel}` : ""}. Seguimiento el ${due} si no responde.`, effects };
  }

  // Reunión confirmada: parada en la jornada de ese día (se crea si no existe) + tarea con el contexto + Calendar.
  if (!targetId && ctx.campaignId && companyId) {
    const { data: t, error } = await db.from("campaign_targets").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.campaignId, company_id: companyId, status: "contactado" }).select("id").single();
    if (error) throw error;
    targetId = t.id;
    effects.created_target = t.id;
  }
  if (targetId) {
    const { data: plan } = await db.from("visit_plans").select("id, visit_stops(count)").eq("planned_on", e.date!).eq("campaign_id", ctx.campaignId!).limit(1).maybeSingle();
    let planId = plan?.id ?? null;
    if (!planId) {
      const { data: p, error } = await db.from("visit_plans").insert({ workspace_id: ctx.workspaceId, campaign_id: ctx.campaignId, title: `Agenda ${e.date}`, planned_on: e.date! }).select("id").single();
      if (error) throw error;
      planId = p.id;
      effects.created_plan = p.id;
    }
    const position = plan?.visit_stops[0]?.count ?? 0;
    const { data: s, error } = await db
      .from("visit_stops")
      .insert({ workspace_id: ctx.workspaceId, plan_id: planId, target_id: targetId, position, target_time: e.time ?? null, status: "confirmada", notes: [person?.full_name ? `Con ${person.full_name}` : null, e.place, e.objective].filter(Boolean).join(" · ") || null })
      .select("id")
      .single();
    if (error) throw error;
    effects.created_stop = s.id;
  }
  const title = `Reunión con ${who}${e.time ? ` · ${e.time}` : ""}`;
  const { data: task, error } = await db
    .from("tasks")
    .insert({ workspace_id: ctx.workspaceId, title, kind: "Reunión", channel: e.channel ?? null, due_on: e.date!, status: "todo", contact_id: contactId, target_id: targetId, campaign_id: ctx.campaignId, assignee_id: ctx.userId, description: [e.objective ? `Objetivo: ${e.objective}` : null, e.place ? `Lugar: ${e.place}` : null, e.note].filter(Boolean).join("\n") || null })
    .select("id")
    .single();
  if (error) throw error;
  effects.created_tasks.push(task.id);
  // Ya no hace falta el pedido de reunión pendiente con esa persona.
  if (contactId) {
    const { data: open } = await db.from("tasks").select("id, title, status, completed_at").neq("status", "done").eq("contact_id", contactId).neq("id", task.id);
    for (const t of (open ?? []).filter((x) => OUTREACH_TASK.test(x.title))) {
      await db.from("tasks").update({ status: "done", completed_at: now.toISOString() }).eq("id", t.id);
      effects.closed_tasks.push({ id: t.id, status: t.status, completed_at: t.completed_at });
    }
  }
  effects.calendar_url = calendarLink({ title, date: e.date!, time: e.time, details: [e.objective, e.note].filter(Boolean).join("\n"), place: e.place });
  return { summary: `${title} · ${e.date}${e.place ? ` · ${e.place}` : ""}. Quedó en la agenda de la misión.`, effects };
}

/** Deshace lo que aplicó un evento: borra lo creado y devuelve las tareas cerradas a su estado anterior. */
export async function undoContactEvent(db: Db, effects: EventEffects): Promise<void> {
  if (effects.created_stop) await db.from("visit_stops").delete().eq("id", effects.created_stop);
  if (effects.created_tasks.length) await db.from("tasks").delete().in("id", effects.created_tasks);
  for (const t of effects.closed_tasks) await db.from("tasks").update({ status: t.status, completed_at: t.completed_at }).eq("id", t.id);
  if (effects.created_plan) {
    const { count } = await db.from("visit_stops").select("id", { count: "exact", head: true }).eq("plan_id", effects.created_plan);
    if (!count) await db.from("visit_plans").delete().eq("id", effects.created_plan);
  }
  if (effects.created_target) await db.from("campaign_targets").delete().eq("id", effects.created_target);
}

export const effectsJson = (e: EventEffects) => e as unknown as Json;
