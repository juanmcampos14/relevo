"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { labelRefs, type RefLabel } from "@/server/ai/labels";
import { runTurn } from "@/server/ai/turn";
import { configuredTranscriber } from "@/server/capture/transcribe";
import { draftsView, type PanelDraft } from "@/server/ai/panel-view";
import { decideDraft, undoDraft } from "./actions";
import { structureLater } from "@/server/capture/background";
import { CAPTURE_BUCKET } from "@/domain/capture";
import { approveCaptureAction } from "../capturas/actions";
import { decideProposal } from "@/server/capture/promote";
import { captureExceptions, type ReviewProposal } from "@/domain/capture-review";

// Panel persistente de RELEVO: mismo motor que la página de RELEVO AI, con el contexto de la pantalla.

export type { PanelDraft } from "@/server/ai/panel-view";
export type PanelCapture = {
  id: string;
  href: string;
  summary: string | null;
  unknowns: string[];
  items: { kind: string; text: string; exception: string | null; status: string }[];
  pending: number;
  exceptions: number;
};
export type PanelReply =
  | { ok: true; conversationId: string; text: string; labels: Record<string, RefLabel>; drafts: PanelDraft[]; navigate: string | null; captures: PanelCapture[]; webSources: { url: string; title: string }[]; homeChanged?: boolean }
  | { ok: false; conversationId: string | null; message: string };

const KIND: Record<string, string> = { company: "Organización", asset: "Activo", person: "Persona", evidence: "Dato", finding: "Hipótesis", next_action: "Próxima acción" };

async function captureCard(slug: string, id: string): Promise<PanelCapture | null> {
  const supabase = await createClient();
  const [{ data: c }, { data: props }] = await Promise.all([
    supabase.from("captures").select("id, ai_summary, ai_unknowns, status").eq("id", id).maybeSingle(),
    supabase.from("proposals").select("id, kind, status, payload, matches").eq("capture_id", id).order("position"),
  ]);
  if (!c) return null;
  const exceptions = captureExceptions((props ?? []) as unknown as ReviewProposal[]);
  return {
    id,
    href: `/w/${slug}/capturas/${id}`,
    summary: c.ai_summary,
    unknowns: c.ai_unknowns ?? [],
    items: (props ?? []).map((p) => {
      const v = p.payload as Record<string, unknown>;
      const refined = typeof v.refined_statement === "string" && v.refined_statement ? ` → reformula: «${v.refined_statement}»` : "";
      const text = String(v.statement ?? v.name ?? v.title ?? v.role ?? "") + refined;
      return { kind: KIND[p.kind] ?? p.kind, text, exception: exceptions.get(p.id) ?? null, status: p.status };
    }),
    pending: (props ?? []).filter((p) => p.status === "propuesta").length,
    exceptions: exceptions.size,
  };
}

/** "Aprobar" desde el panel: lo normal se guarda y relaciona; lo que requiere decisión queda para la captura. */
export async function approveFromPanel(slug: string, captureId: string): Promise<{ card: PanelCapture | null; message: string }> {
  const res = await approveCaptureAction(slug, captureId);
  return { card: await captureCard(slug, captureId), message: res.message ?? "" };
}

/** "Ignorar": no se guarda nada de lo propuesto; la captura original queda como material crudo. */
export async function ignoreFromPanel(slug: string, captureId: string): Promise<{ card: PanelCapture | null }> {
  const ctx = await getWorkspaceContext(slug);
  if (ctx.canEdit) {
    const supabase = await createClient();
    const { data: props } = await supabase.from("proposals").select("id").eq("capture_id", captureId).eq("status", "propuesta");
    for (const p of props ?? []) await decideProposal(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, proposalId: p.id, decision: { action: "rechazar" } });
  }
  return { card: await captureCard(slug, captureId) };
}

export async function askRelevo(slug: string, input: { conversationId: string | null; scope: string; screen: string; text: string; here?: { lat: number; lng: number; accuracy?: number } | null; place?: string | null; captureId?: string | null }): Promise<PanelReply> {
  const ctx = await getWorkspaceContext(slug);
  const text = z.string().trim().min(1).max(4000).safeParse(input.text);
  if (!text.success) return { ok: false, conversationId: input.conversationId, message: "Escribí una pregunta." };
  const scope = /^[a-z]+:[0-9a-f-]{36}$/.test(input.scope) ? input.scope : "";
  const supabase = await createClient();
  // Foto de la calle: ya quedó guardada como captura (con ubicación). RELEVO la ve en este turno y el Brain la
  // estructura en background, sin que nadie la clasifique.
  const captureId = input.captureId && /^[0-9a-f-]{36}$/.test(input.captureId) ? input.captureId : null;
  const images: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[] = [];
  if (captureId) {
    const { data: media } = await supabase.from("capture_media").select("storage_path, mime_type, kind").eq("capture_id", captureId).eq("kind", "photo").limit(3);
    for (const m of media ?? []) {
      const { data: blob } = await supabase.storage.from(CAPTURE_BUCKET).download(m.storage_path);
      if (!blob) continue;
      const type = (["image/jpeg", "image/png", "image/webp"].includes(m.mime_type) ? m.mime_type : "image/jpeg") as "image/jpeg";
      images.push({ mediaType: type, data: Buffer.from(await blob.arrayBuffer()).toString("base64") });
    }
  }
  const res = await runTurn(supabase, {
    slug, workspaceId: ctx.workspace.id, workspaceName: ctx.workspace.name, userId: ctx.user.id,
    conversationId: input.conversationId, text: text.data, scope, screen: input.screen.slice(0, 120),
    settings: ctx.workspace.settings,
    here: input.here && Number.isFinite(input.here.lat) && Number.isFinite(input.here.lng) ? input.here : null,
    place: input.place?.slice(0, 120) ?? null,
    images: images.length ? images : undefined,
    attachedCaptureId: captureId,
  });
  if (captureId) await structureLater(supabase, { workspaceId: ctx.workspace.id, settings: ctx.workspace.settings, userId: ctx.user.id, captureId, focus: text.data });
  if (!res.ok) return res;
  const labels = await labelRefs(supabase, slug, res.citations);
  const captures = (await Promise.all(res.captureIds.map((id) => captureCard(slug, id)))).filter((c): c is PanelCapture => !!c);
  return { ok: true, conversationId: res.conversationId, text: res.text, labels: Object.fromEntries(labels), drafts: await draftsView(slug, res.draftIds), navigate: res.navigate, captures, webSources: res.webSources, homeChanged: res.homeChanged };
}

/** Nombre legible del lugar donde está la persona ("Palermo, Buenos Aires"): contexto, no un módulo. */
export async function placeName(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`, { headers: { "User-Agent": "RELEVO-OS/1.0 (hola@relevo.site)", "Accept-Language": "es" }, signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.town ?? a.village ?? null;
    const city = a.city ?? a.town ?? a.village ?? a.state ?? null;
    return [area, city !== area ? city : null].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

/** Aprobar o rechazar una propuesta desde el panel; devuelve cómo quedó (con enlace al resultado). */
export async function decideFromPanel(slug: string, draftId: string, verdict: "aprobar" | "rechazar"): Promise<PanelDraft | null> {
  await decideDraft(slug, draftId, verdict);
  return (await draftsView(slug, [draftId]))[0] ?? null;
}

/** Deshacer una acción que RELEVO aplicó sola; devuelve cómo quedó. */
export async function undoFromPanel(slug: string, draftId: string): Promise<PanelDraft | null> {
  await undoDraft(slug, draftId);
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
