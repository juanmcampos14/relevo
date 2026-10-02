import "server-only";

import { createClient } from "@/lib/supabase/server";
import { labelRefs } from "@/server/ai/labels";
import type { Preview } from "@/server/ai/drafts";

// Cómo se ve una acción de RELEVO en la conversación (propuesta para decidir o ya aplicada, con Deshacer).

export type PanelDraft = { id: string; action: string; status: string; rationale: string | null; preview: Preview | null; error: string | null; resultHref: string | null; applied: boolean; calendarUrl: string | null };

export async function draftsView(slug: string, ids: string[]): Promise<PanelDraft[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("ai_action_drafts").select("id, action, status, rationale, preview, error, result_ref, after_state").in("id", ids).order("created_at");
  const labels = await labelRefs(supabase, slug, (data ?? []).map((d) => d.result_ref).filter((x): x is string => !!x));
  return (data ?? []).map((d) => ({
    id: d.id,
    action: d.action,
    status: d.status,
    rationale: d.rationale,
    preview: (d.preview as Preview | null) && Object.keys(d.preview as object).length ? (d.preview as Preview) : null,
    error: d.error,
    resultHref: d.result_ref ? labels.get(d.result_ref)?.href ?? null : null,
    applied: d.action === "contact_event" || d.action === "relationship_change",
    calendarUrl: (d.after_state as { calendar_url?: string | null } | null)?.calendar_url ?? null,
  }));
}

