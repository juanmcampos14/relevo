"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { labelRefs, type RefLabel } from "@/server/ai/labels";
import { runTurn } from "@/server/ai/turn";
import { configuredTranscriber } from "@/server/capture/transcribe";
import type { Preview } from "@/server/ai/drafts";
import { decideDraft } from "./actions";

// Panel persistente de RELEVO: mismo motor que la página de RELEVO AI, con el contexto de la pantalla.

export type PanelDraft = { id: string; action: string; status: string; rationale: string | null; preview: Preview | null; error: string | null; resultHref: string | null };
export type PanelReply =
  | { ok: true; conversationId: string; text: string; labels: Record<string, RefLabel>; drafts: PanelDraft[]; navigate: string | null }
  | { ok: false; conversationId: string | null; message: string };

async function draftsView(slug: string, ids: string[]): Promise<PanelDraft[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("ai_action_drafts").select("id, action, status, rationale, preview, error, result_ref").in("id", ids).order("created_at");
  const labels = await labelRefs(supabase, slug, (data ?? []).map((d) => d.result_ref).filter((x): x is string => !!x));
  return (data ?? []).map((d) => ({
    id: d.id,
    action: d.action,
    status: d.status,
    rationale: d.rationale,
    preview: (d.preview as Preview | null) && Object.keys(d.preview as object).length ? (d.preview as Preview) : null,
    error: d.error,
    resultHref: d.result_ref ? labels.get(d.result_ref)?.href ?? null : null,
  }));
}

export async function askRelevo(slug: string, input: { conversationId: string | null; scope: string; screen: string; text: string }): Promise<PanelReply> {
  const ctx = await getWorkspaceContext(slug);
  const text = z.string().trim().min(1).max(4000).safeParse(input.text);
  if (!text.success) return { ok: false, conversationId: input.conversationId, message: "Escribí una pregunta." };
  const scope = /^[a-z]+:[0-9a-f-]{36}$/.test(input.scope) ? input.scope : "";
  const supabase = await createClient();
  const res = await runTurn(supabase, {
    slug, workspaceId: ctx.workspace.id, workspaceName: ctx.workspace.name, userId: ctx.user.id,
    conversationId: input.conversationId, text: text.data, scope, screen: input.screen.slice(0, 120),
  });
  if (!res.ok) return res;
  const labels = await labelRefs(supabase, slug, res.citations);
  return { ok: true, conversationId: res.conversationId, text: res.text, labels: Object.fromEntries(labels), drafts: await draftsView(slug, res.draftIds), navigate: res.navigate };
}

/** Aprobar o rechazar una propuesta desde el panel; devuelve cómo quedó (con enlace al resultado). */
export async function decideFromPanel(slug: string, draftId: string, verdict: "aprobar" | "rechazar"): Promise<PanelDraft | null> {
  await decideDraft(slug, draftId, verdict);
  return (await draftsView(slug, [draftId]))[0] ?? null;
}

/** Pregunta dictada → texto (para revisarlo antes de enviar). Requiere el consentimiento de IA del workspace. */
export async function transcribeQuestion(slug: string, fd: FormData): Promise<{ text?: string; error?: string }> {
  const ctx = await getWorkspaceContext(slug);
  if ((ctx.workspace.settings as { ai_processing_consent?: boolean } | null)?.ai_processing_consent !== true) return { error: "El workspace no habilitó el procesamiento con IA." };
  const file = fd.get("audio");
  if (!(file instanceof Blob) || file.size === 0) return { error: "No llegó el audio." };
  if (file.size > 8 * 1024 * 1024) return { error: "El audio es muy largo para una pregunta." };
  const transcriber = configuredTranscriber();
  if (!transcriber) return { error: "La transcripción no está configurada en este entorno." };
  const t = await transcriber(await file.arrayBuffer(), file.type || "audio/webm");
  return t.ok ? { text: t.text } : { error: t.error };
}
