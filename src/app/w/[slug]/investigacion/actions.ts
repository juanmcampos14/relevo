"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { ensureVoiceExperiment, newPreviewToken } from "@/server/voice/experiment";
import { importMetaCsv } from "@/server/voice/admin";
import { redactAnswers, type Answers } from "@/domain/voice/survey";

// Acciones del experimento. Aprobar presupuesto o publicación = decisión con can_approve (mismo guard
// que el resto de RELEVO). Publicar exige ambas aprobaciones y la identidad real completa.

const base = (slug: string) => `/w/${slug}/investigacion`;
async function admin(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("Solo owner o admin.");
  return ctx;
}
const fail = (e: unknown): ActionState => ({ message: e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Error" });

export async function createVoiceExperiment(slug: string): Promise<ActionState> {
  try {
    const ctx = await admin(slug);
    const supabase = await createClient();
    const { data: mission } = await supabase.from("campaigns").select("id").eq("kind", "mision").eq("status", "activa").order("created_at").limit(1).maybeSingle();
    await ensureVoiceExperiment(supabase, ctx.workspace.id, mission?.id ?? null);
    revalidatePath(base(slug), "layout");
    return { ok: true, message: "Experimento creado en borrador (no público)." };
  } catch (e) {
    return fail(e);
  }
}

const Identity = z.object({
  responsible_name: z.string().trim().min(3).max(120),
  contact_email: z.email(),
  privacy_notice: z.string().trim().min(40).max(2000),
  retention_days: z.coerce.number().int().min(30).max(1095),
});
export async function saveIdentity(slug: string, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await admin(slug);
    const p = Identity.safeParse(Object.fromEntries(fd));
    if (!p.success) return { errors: Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), "Revisá este campo."])) };
    const supabase = await createClient();
    const { error } = await supabase.from("research_experiments").update({ ...p.data, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(base(slug), "layout");
    return { ok: true, message: "Identidad y datos guardados." };
  } catch (e) {
    return fail(e);
  }
}

/** Enlace de revisión (borrador/piloto): se muestra una sola vez; el anterior deja de servir. */
export async function rotatePreviewLink(slug: string, id: string): Promise<ActionState & { link?: string }> {
  try {
    await admin(slug);
    const supabase = await createClient();
    const { token, hash } = newPreviewToken();
    const { data: e, error } = await supabase.from("research_experiments").update({ preview_token_hash: hash }).eq("id", id).select("slug").single();
    if (error) return { message: dbErrorMessage(error) };
    return { ok: true, message: "Enlace de revisión nuevo (el anterior dejó de funcionar).", link: `/r/${e.slug}?t=${token}` };
  } catch (e) {
    return fail(e);
  }
}

export async function setExperimentStatus(slug: string, id: string, status: "borrador" | "piloto" | "activo" | "pausado" | "cerrado"): Promise<ActionState> {
  try {
    await admin(slug);
    const supabase = await createClient();
    const { data: e } = await supabase.from("research_experiments").select("status, responsible_name, contact_email, privacy_notice, budget_decision_id, publication_decision_id").eq("id", id).single();
    if (!e) return { message: "Experimento no encontrado." };
    if ((status === "piloto" || status === "activo") && (!e.responsible_name || !e.contact_email || !e.privacy_notice)) return { message: "Falta completar responsable, contacto real y aviso de privacidad." };
    if (status === "activo") {
      const ids = [e.budget_decision_id, e.publication_decision_id].filter((x): x is string => !!x);
      const { data: ds } = ids.length ? await supabase.from("decisions").select("kind, status").in("id", ids) : { data: [] };
      const ok = (k: string) => ds?.some((d) => d.kind === k && d.status === "approved");
      if (!ok("aprobar_presupuesto") || !ok("aprobar_publicacion")) return { message: "Para abrir al público hacen falta el presupuesto y la publicación aprobados." };
    }
    const { error } = await supabase.from("research_experiments").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(base(slug), "layout");
    return { ok: true, message: `Estado: ${status}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function requestApproval(slug: string, id: string, kind: "aprobar_presupuesto" | "aprobar_publicacion", _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const context = String(fd.get("context") ?? "").trim();
  if (context.length < 10) return { errors: { context: "Detallá qué se aprueba (montos, piezas, cuenta, fechas)." } };
  const supabase = await createClient();
  const question = kind === "aprobar_presupuesto" ? "¿Aprobamos el presupuesto de pauta de Voice of Añelo?" : "¿Aprobamos publicar Voice of Añelo (landing, cuestionario, anuncios y cuenta)?";
  const { data, error } = await supabase.from("decisions").insert({ workspace_id: ctx.workspace.id, experiment_id: id, kind, question, context }).select("id").single();
  if (error) return { message: dbErrorMessage(error) };
  await supabase.from("research_experiments").update(kind === "aprobar_presupuesto" ? { budget_decision_id: data.id } : { publication_decision_id: data.id }).eq("id", id);
  revalidatePath(base(slug), "layout");
  return { ok: true, message: "Solicitud creada: la decide quien tiene capacidad de aprobar." };
}

export async function decideApproval(slug: string, decisionId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canApprove) return { message: "Se requiere la capacidad de aprobar decisiones." };
  const status = fd.get("verdict") === "aprobar" ? "approved" : "rejected";
  const supabase = await createClient();
  const { error } = await supabase.from("decisions").update({ status, decision_note: String(fd.get("note") ?? "").trim() || null, updated_at: new Date().toISOString() }).eq("id", decisionId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(base(slug), "layout");
  return { ok: true, message: status === "approved" ? "Aprobado." : "Rechazado." };
}

export async function saveVariantMeta(slug: string, variantId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await admin(slug);
    const clean = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return /^\d{5,25}$/.test(v) ? v : null;
    };
    const supabase = await createClient();
    const { error } = await supabase.from("experiment_variants").update({ meta_campaign_id: clean("meta_campaign_id"), meta_adset_id: clean("meta_adset_id"), meta_ad_id: clean("meta_ad_id") }).eq("id", variantId);
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(base(slug), "layout");
    return { ok: true, message: "IDs de Meta guardados (solo números)." };
  } catch (e) {
    return fail(e);
  }
}

export async function uploadMetaCsv(slug: string, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await admin(slug);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { errors: { file: "Elegí el CSV exportado de Ads Manager." } };
    if (file.size > 2 * 1024 * 1024) return { errors: { file: "El archivo es muy grande (máx. 2 MB)." } };
    const supabase = await createClient();
    const r = await importMetaCsv(supabase, ctx.workspace.id, id, file.name, await file.text());
    if ("error" in r) return { message: r.error };
    revalidatePath(base(slug), "layout");
    return { ok: true, message: `${r.applied} filas (${r.currency ?? "?"}, ${r.period.join(" → ")}). Rechazadas: ${r.rejected.length}. Sin variante: ${r.unmatched.length}.` };
  } catch (e) {
    return fail(e);
  }
}

const Cost = z.object({ kind: z.enum(["facturado_meta", "iva", "percepcion", "ingresos_brutos", "honorarios", "otro"]), amount: z.coerce.number().positive(), currency: z.enum(["ARS", "USD"]), fx_rate: z.coerce.number().positive().optional().or(z.literal("").transform(() => undefined)), period: z.string().trim().max(40).optional(), document_ref: z.string().trim().max(200).optional() });
export async function addCost(slug: string, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await admin(slug);
    const p = Cost.safeParse(Object.fromEntries(fd));
    if (!p.success) return { message: "Revisá tipo, monto y moneda." };
    const supabase = await createClient();
    const { error } = await supabase.from("experiment_costs").insert({ workspace_id: ctx.workspace.id, experiment_id: id, ...p.data, fx_rate: p.data.fx_rate ?? null });
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(base(slug), "layout");
    return { ok: true, message: "Costo registrado." };
  } catch (e) {
    return fail(e);
  }
}

/** Revisar: el texto libre queda redactado y el original deja de existir (irreversible). */
export async function reviewResponse(slug: string, responseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await admin(slug);
    const verdict = String(fd.get("verdict") ?? "");
    const supabase = await createClient();
    const { data: r } = await supabase.from("survey_responses").select("answers").eq("id", responseId).single();
    if (!r) return { message: "Respuesta no encontrada." };
    if (verdict === "borrar") {
      const { data: s } = await supabase.from("survey_responses").select("session_id").eq("id", responseId).single();
      await supabase.from("survey_sessions").delete().eq("id", s!.session_id);
      revalidatePath(base(slug), "layout");
      return { ok: true, message: "Respuesta borrada." };
    }
    const redacted = redactAnswers(r.answers as unknown as Answers).answers;
    const { error } = await supabase
      .from("survey_responses")
      .update({ answers: redacted as never, review_status: verdict === "descartar" ? "descartada" : "revisada", review_note: String(fd.get("note") ?? "").trim() || null, reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString() })
      .eq("id", responseId);
    if (error) return { message: dbErrorMessage(error) };
    revalidatePath(base(slug), "layout");
    return { ok: true, message: verdict === "descartar" ? "Descartada (no cuenta en resultados)." : "Revisada: texto libre redactado." };
  } catch (e) {
    return fail(e);
  }
}

/** Pedido de borrado con el código que recibió la persona al terminar. */
export async function deleteByCode(slug: string, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await admin(slug);
    const code = String(fd.get("code") ?? "").trim().toUpperCase();
    const supabase = await createClient();
    const { data: r } = await supabase.from("survey_responses").select("session_id").eq("experiment_id", id).eq("deletion_code", code).maybeSingle();
    if (!r) return { message: "No hay una respuesta con ese código." };
    await supabase.from("survey_sessions").delete().eq("id", r.session_id);
    revalidatePath(base(slug), "layout");
    return { ok: true, message: "Respuesta borrada (queda registro en auditoría sin el contenido)." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Respuesta revisada → evidencia (DECLARACIÓN de una persona encuestada) vinculada a una hipótesis, a favor,
 * en contra o como contexto. Decide una persona; nunca promueve nada.
 */
export async function responseToEvidence(slug: string, responseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await admin(slug);
    const statement = String(fd.get("statement") ?? "").trim();
    const findingId = String(fd.get("finding_id") ?? "");
    const stance = String(fd.get("stance") ?? "");
    if (statement.length < 10) return { errors: { statement: "Resumí el episodio (sin nombres)." } };
    if (!["supports", "contradicts", "contextual"].includes(stance)) return { message: "Elegí a favor, en contra o contexto." };
    const supabase = await createClient();
    const { data: r } = await supabase.from("survey_responses").select("id, review_status, experiment_id, created_at, cohort").eq("id", responseId).single();
    if (!r || r.review_status !== "revisada") return { message: "Primero revisá la respuesta (redacta el texto libre)." };
    if (r.cohort !== "real") return { message: "Las respuestas de prueba o piloto no se convierten en evidencia." };
    const { data: e } = await supabase.from("research_experiments").select("title").eq("id", r.experiment_id).single();
    const url = `https://www.relevo.site/r/voice-anelo`;
    let { data: src } = await supabase.from("sources").select("id").eq("workspace_id", ctx.workspace.id).eq("reference", `voice:${r.experiment_id}`).maybeSingle();
    if (!src) {
      const { data, error } = await supabase.from("sources").insert({ workspace_id: ctx.workspace.id, kind: "documento", title: `${e?.title ?? "Voice"} · respuestas (declaraciones, no representativas)`, reference: `voice:${r.experiment_id}`, url, notes: "Relevamiento autoseleccionado: cada respuesta es una declaración." }).select("id").single();
      if (error) return { message: dbErrorMessage(error) };
      src = data;
    }
    const { data: ev, error } = await supabase
      .from("evidence")
      .insert({ workspace_id: ctx.workspace.id, statement: statement.slice(0, 1000), evidence_type: "declaracion", origin_kind: "survey", verification_status: "unverified", source_id: src.id, survey_response_id: r.id, observed_at: r.created_at, declared_by: "Persona encuestada (Voice of Añelo)" })
      .select("id")
      .single();
    if (error) return { message: dbErrorMessage(error) };
    if (findingId) {
      const { error: e2 } = await supabase.from("finding_evidence").insert({ workspace_id: ctx.workspace.id, finding_id: findingId, evidence_id: ev.id, stance: stance as "supports" | "contradicts" | "contextual" });
      if (e2) return { message: dbErrorMessage(e2) };
    }
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true, message: findingId ? "Evidencia creada y vinculada a la hipótesis." : "Evidencia creada." };
  } catch (e) {
    return fail(e);
  }
}
