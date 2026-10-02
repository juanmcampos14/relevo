import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { randomUUID } from "node:crypto";
import { EMPTY_FOCUS, correct, mergeSynthesis, resolveByRefs, visible, type Correction, type Focus, type FocusItem } from "@/domain/focus";
import type { ContactEvent } from "@/server/ai/contact-events";

// El foco vive junto a la síntesis de la misión (campaigns.synthesis.focus): la síntesis profunda lo propone,
// cada acción y cada corrección lo cambian al instante, y el Avanzar de lo visible se prepara en background
// para que en la calle la respuesta llegue sin esperar.

type Db = SupabaseClient<Database>;

export async function activeMission(db: Db): Promise<string | null> {
  const { data } = await db.from("campaigns").select("id").eq("kind", "mision").eq("status", "activa").order("starts_on", { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function loadFocus(db: Db, campaignId: string): Promise<Focus> {
  const { data } = await db.from("campaigns").select("synthesis").eq("id", campaignId).maybeSingle();
  const f = (data?.synthesis as { focus?: Focus } | null)?.focus;
  return f?.items ? { items: f.items, log: f.log ?? [] } : EMPTY_FOCUS;
}

/** Lee, cambia y guarda el foco (lo demás de la síntesis queda igual). */
export async function updateFocus(db: Db, campaignId: string, change: (f: Focus) => Focus): Promise<Focus | null> {
  const { data } = await db.from("campaigns").select("synthesis").eq("id", campaignId).maybeSingle();
  const synthesis = (data?.synthesis ?? {}) as Record<string, unknown>;
  const current = (synthesis.focus as Focus | undefined)?.items ? (synthesis.focus as Focus) : EMPTY_FOCUS;
  const next = change(current);
  if (next === current) return current;
  const { error } = await db.from("campaigns").update({ synthesis: { ...synthesis, focus: next } as unknown as Json }).eq("id", campaignId);
  return error ? null : next;
}

export async function applyCorrection(db: Db, campaignId: string, c: Correction, by: string | null): Promise<Focus | null> {
  return updateFocus(db, campaignId, (f) => correct(f, c, by, new Date()));
}

/** Se dio un paso con estas empresas o personas: las prioridades que eran eso se resuelven y aparece la siguiente. */
export async function resolveFocus(db: Db, campaignId: string, refs: string[], note: string): Promise<FocusItem[]> {
  let resolved: FocusItem[] = [];
  await updateFocus(db, campaignId, (f) => {
    const r = resolveByRefs(f, refs, note, new Date());
    resolved = r.resolved;
    return r.resolved.length || r.focus !== f ? r.focus : f;
  });
  return resolved;
}

/**
 * El foco de ahora, vivo: lo que se cerró por otro lado (una tarea hecha en el panel, por ejemplo) se resuelve
 * antes de mostrarlo. Devuelve lo visible y el foco completo.
 */
export async function liveFocus(db: Db, campaignId: string, now = new Date()): Promise<{ focus: Focus; now: FocusItem[] }> {
  let focus = await loadFocus(db, campaignId);
  if (!focus.items.length) {
    // Primera vez: el foco nace de la síntesis que ya estaba preparada.
    const { data } = await db.from("campaigns").select("synthesis").eq("id", campaignId).maybeSingle();
    type I = { title: string; why: string; refs: string[]; done?: boolean };
    const syn = data?.synthesis as { today?: I[]; this_week?: I[] } | null;
    if (syn?.today?.length) focus = (await updateFocus(db, campaignId, (f) => (f.items.length ? f : mergeSynthesis(f, { today: syn.today ?? [], week: syn.this_week ?? [] }, now, randomUUID)))) ?? focus;
  }
  const taskIds = [...new Set(visible(focus, now, 10).flatMap((x) => x.refs.filter((r) => r.startsWith("task:")).map((r) => r.split(":")[1])))];
  if (taskIds.length) {
    const { data: done } = await db.from("tasks").select("id").in("id", taskIds).eq("status", "done");
    const closed = new Set((done ?? []).map((t) => `task:${t.id}`));
    const finished = visible(focus, now, 10).filter((x) => { const ts = x.refs.filter((r) => r.startsWith("task:")); return ts.length > 0 && ts.every((r) => closed.has(r)); });
    if (finished.length) {
      focus = (await updateFocus(db, campaignId, (f) => finished.reduce((acc, it) => correct(acc, { kind: "hecha", id: it.id, note: "Se cerró la tarea" }, null, now), f))) ?? focus;
    }
  }
  return { focus, now: visible(focus, now) };
}

export { SIGNATURE, signMessages } from "@/domain/focus";

/** Se dio un paso con alguien (mensaje enviado, reunión confirmada): se resuelve lo del home que era eso. */
export async function stepTaken(db: Db, missionId: string, e: Pick<ContactEvent, "contact_ref" | "company_ref">, note: string): Promise<{ resolved: FocusItem[]; next: FocusItem | null }> {
  const refs = [e.contact_ref, e.company_ref].filter((r): r is string => !!r);
  const contactId = e.contact_ref?.split(":")[1];
  if (contactId) {
    const { data } = await db.from("contact_links").select("company_id").eq("contact_id", contactId);
    for (const l of data ?? []) if (l.company_id) refs.push(`company:${l.company_id}`);
  }
  const resolved = await resolveFocus(db, missionId, [...new Set(refs)], note);
  const next = visible(await loadFocus(db, missionId), new Date())[0] ?? null;
  return { resolved, next };
}
