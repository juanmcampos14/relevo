"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { labelRefs } from "@/server/ai/labels";
import { draftsView, type PanelDraft } from "@/server/ai/panel-view";
import { applyContactEvent, ContactEventInput, followUpDay } from "@/server/ai/contact-events";
import { activeMission, applyCorrection, liveFocus, signMessages, stepTaken } from "@/server/mission/focus";
import { laterPrepare } from "@/server/ai/turn";
import { moveIsFresh, type Correction } from "@/domain/focus";
import { askRelevo, type PanelReply } from "@/app/w/[slug]/ai/panel-actions";
import { memoryNearby } from "@/server/geo";
import { formatDistance } from "@/domain/geo";
import type { LookItem } from "@/server/surface";

// Acciones del home (Surface): Avanzar responde al instante si RELEVO ya lo preparó; "¿Lo mandaste? Sí" y
// las correcciones de prioridad cambian el presente en el momento.

const fullNameOf = (settings: unknown, userId: string) => ((settings as { team?: Record<string, { full?: string; short?: string }> } | null)?.team ?? {})[userId]?.full ?? null;

/** Avanzar sobre una prioridad del home. */
export async function advance(slug: string, input: { focusId: string; conversationId: string | null; here?: { lat: number; lng: number; accuracy?: number } | null; place?: string | null }): Promise<PanelReply> {
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const mission = await activeMission(supabase);
  const item = mission ? (await liveFocus(supabase, mission)).focus.items.find((x) => x.id === input.focusId) : null;
  if (!item) return { ok: false, conversationId: input.conversationId, message: "Esa prioridad ya no está. Te muestro lo de ahora." };
  const question = `Avanzar: ${item.title}`;
  const now = new Date();
  if (!item.move || !moveIsFresh(item, now)) {
    return askRelevo(slug, { conversationId: input.conversationId, scope: "", screen: "Conversar (calle)", text: question, here: input.here, place: input.place });
  }
  // Ya preparado: queda en la conversación (para seguir hablando de eso) y se muestra sin esperar.
  const text = signMessages(item.move.text, fullNameOf(ctx.workspace.settings, ctx.user.id) ?? ctx.user.email ?? null);
  let convId = input.conversationId;
  if (!convId) {
    const { data, error } = await supabase.from("ai_conversations").insert({ workspace_id: ctx.workspace.id, user_id: ctx.user.id, title: question.slice(0, 80), scope: { type: "workspace" } }).select("id").single();
    if (error) return { ok: false, conversationId: null, message: error.message };
    convId = data.id;
  }
  await supabase.from("ai_messages").insert({ workspace_id: ctx.workspace.id, conversation_id: convId, role: "user", text: question, api_content: [{ role: "user", content: [{ type: "text", text: question }] }] as never });
  await supabase.from("ai_messages").insert({ workspace_id: ctx.workspace.id, conversation_id: convId, role: "assistant", text, api_content: [{ role: "assistant", content: [{ type: "text", text }] }] as never, citations: item.move.citations });
  await supabase.from("ai_conversations").update({ updated_at: now.toISOString() }).eq("id", convId);
  const labels = await labelRefs(supabase, slug, item.move.citations);
  return { ok: true, conversationId: convId, text, labels: Object.fromEntries(labels), drafts: [], navigate: null, captures: [], webSources: [] };
}

export type SentResult = { ok: true; draft: PanelDraft | null; line: string } | { ok: false; message: string };

/** "¿Lo mandaste?" → Sí. Cierra el pendiente, deja el seguimiento y el home pasa a lo siguiente. Se puede deshacer. */
export async function markSent(slug: string, input: { ref: string; conversationId: string | null }): Promise<SentResult> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { ok: false, message: "No tenés permiso para registrar esto." };
  const ref = z.string().regex(/^(contact|company):[0-9a-f-]{36}$/).safeParse(input.ref);
  if (!ref.success) return { ok: false, message: "No sé a quién se lo mandaste." };
  const event = ContactEventInput.parse({ event: "mensaje_enviado", ...(ref.data.startsWith("contact:") ? { contact_ref: ref.data } : { company_ref: ref.data }) });
  const supabase = await createClient();
  const mission = await activeMission(supabase);
  try {
    const { summary, effects } = await applyContactEvent(supabase, { workspaceId: ctx.workspace.id, userId: ctx.user.id, campaignId: mission }, event);
    let draftId: string | null = null;
    if (input.conversationId) {
      const { data } = await supabase
        .from("ai_action_drafts")
        .insert({ workspace_id: ctx.workspace.id, conversation_id: input.conversationId, action: "contact_event", payload: event as never, rationale: summary, evidence_refs: [], preview: { summary, changes: [], why: summary, evidence_refs: [], duplicate_risk: [], expected: summary, applied: true } as never })
        .select("id")
        .single();
      if (data) {
        await supabase.from("ai_action_drafts").update({ status: "ejecutada", decided_by: ctx.user.id, decided_at: new Date().toISOString(), after_state: effects as never }).eq("id", data.id);
        draftId = data.id;
      }
    }
    const step = mission ? await stepTaken(supabase, mission, event, summary) : null;
    // Si se deshace, lo que se resolvió del home vuelve.
    if (draftId && step?.resolved.length) await supabase.from("ai_action_drafts").update({ after_state: { ...effects, focus_resolved: step.resolved.map((x) => x.id) } as never }).eq("id", draftId);
    if (mission) laterPrepare(supabase, { workspaceId: ctx.workspace.id, campaignId: mission, slug, settings: ctx.workspace.settings, userId: ctx.user.id });
    const due = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${followUpDay(new Date())}T12:00:00Z`));
    const line = `Listo. Si no responde, te lo traigo el ${due}.${step?.next && step.resolved.length ? ` Lo siguiente: ${step.next.title.charAt(0).toLowerCase()}${step.next.title.slice(1)}.` : ""}`;
    revalidatePath(`/hoy/${slug}`);
    return { ok: true, draft: draftId ? (await draftsView(slug, [draftId]))[0] ?? null : null, line };
  } catch (e) {
    return { ok: false, message: `No pude registrarlo: ${(e as Error).message}` };
  }
}

const CorrectionInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("primero"), id: z.string().uuid() }),
  z.object({ kind: z.literal("orden"), ids: z.array(z.string().uuid()).max(20) }),
  z.object({ kind: z.literal("posponer"), id: z.string().uuid(), until: z.iso.date(), note: z.string().max(300).nullish() }),
  z.object({ kind: z.literal("sacar"), id: z.string().uuid(), note: z.string().max(300).nullish() }),
  z.object({ kind: z.literal("hecha"), id: z.string().uuid(), note: z.string().max(300).nullish() }),
]);

/** La persona corrige la prioridad en un segundo (arrastrar, "primero", "mañana", "sacar"). */
export async function correctFocus(slug: string, input: Exclude<Correction, { kind: "agregar" }>): Promise<{ ok: boolean }> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { ok: false };
  const c = CorrectionInput.safeParse(input);
  if (!c.success) return { ok: false };
  const supabase = await createClient();
  const mission = await activeMission(supabase);
  if (!mission) return { ok: false };
  const next = await applyCorrection(supabase, mission, c.data, ctx.user.id);
  if (next && c.data.kind !== "orden") laterPrepare(supabase, { workspaceId: ctx.workspace.id, campaignId: mission, slug, settings: ctx.workspace.settings, userId: ctx.user.id });
  revalidatePath(`/hoy/${slug}`);
  return { ok: !!next };
}

/** Agregar algo al foco desde la conversación o el home ("sumá ver locales en Libertador"). */
export async function addFocus(slug: string, title: string): Promise<{ ok: boolean }> {
  const ctx = await getWorkspaceContext(slug);
  const t = z.string().trim().min(3).max(200).safeParse(title);
  if (!ctx.canEdit || !t.success) return { ok: false };
  const supabase = await createClient();
  const mission = await activeMission(supabase);
  if (!mission) return { ok: false };
  const next = await applyCorrection(supabase, mission, { kind: "agregar", id: randomUUID(), title: t.data, first: true }, ctx.user.id);
  revalidatePath(`/hoy/${slug}`);
  return { ok: !!next };
}

/** Lo que el Brain tiene cerca de donde está la persona (para Explorar). */
export async function nearby(slug: string, at: { lat: number; lng: number }): Promise<LookItem[]> {
  await getWorkspaceContext(slug);
  if (!Number.isFinite(at.lat) || !Number.isFinite(at.lng)) return [];
  const supabase = await createClient();
  const points = await memoryNearby(supabase, slug, { lat: at.lat, lng: at.lng }, 1500);
  return points.filter((p) => p.kind !== "capture").slice(0, 4).map((p) => ({
    id: p.ref,
    kicker: `Cerca · ${formatDistance(p.distance_m)}`,
    title: p.name,
    line: p.detail ?? null,
    ask: `Contame de ${p.name}, que está acá cerca.`,
  }));
}
