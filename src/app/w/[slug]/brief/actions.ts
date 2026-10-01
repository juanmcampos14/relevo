"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { deliverBrief, ensureTodayBrief, retryBrief } from "@/server/brief/pipeline";
import { chainStep, defaultEngines, runStep, siteUrl } from "@/server/brief/run";

const Recipients = z.array(z.object({ name: z.string().trim().max(80), email: z.email() })).max(10);

/** Destinatarios y activación (owner). Una línea por persona: "Nombre <email>" o solo el email. */
export async function saveBriefSettings(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (ctx.role !== "owner") return { message: "Solo el owner configura el Morning Brief." };
  const lines = String(fd.get("recipients") ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const parsed = Recipients.safeParse(
    lines.map((l) => {
      const m = l.match(/^(.*?)\s*<([^>]+)>$/);
      return m ? { name: m[1].replace(/[",]/g, "").trim(), email: m[2].trim().toLowerCase() } : { name: "", email: l.toLowerCase() };
    }),
  );
  if (!parsed.success) return { errors: { recipients: "Revisá los emails: una persona por línea, «Nombre <email>» o solo el email." } };
  const enabled = fd.get("enabled") === "on";
  const cap = Number(String(fd.get("monthly_cap_usd") ?? "").replace(",", "."));
  if (!Number.isFinite(cap) || cap < 5 || cap > 500) return { errors: { monthly_cap_usd: "Entre USD 5 y 500 por mes." } };
  if (enabled && !parsed.data.length) return { errors: { recipients: "Agregá al menos un destinatario." } };
  const supabase = await createClient();
  const settings = { ...((ctx.workspace.settings as Record<string, unknown> | null) ?? {}), brief: { enabled, recipients: parsed.data, monthlyCapUsd: cap } };
  const { data, error } = await supabase.from("workspaces").update({ settings }).eq("id", ctx.workspace.id).select("id");
  if (error) return { message: dbErrorMessage(error) };
  if (!data?.length) return { message: "Solo el owner puede cambiar esta configuración." };
  revalidatePath(`/w/${slug}/brief`);
  return { ok: true, message: enabled ? `Morning Brief activado para ${parsed.data.length} destinatario(s) (entrega 07:00).` : "Configuración guardada (Morning Brief desactivado)." };
}

async function ownerOnly(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (ctx.role !== "owner") throw new Error("Solo el owner puede hacer esto.");
  return ctx;
}

/** Genera el brief de hoy ahora (o retoma el paso pendiente). Corre en segundo plano, encadenado. */
export async function generateBriefNow(slug: string): Promise<ActionState> {
  try {
    const ctx = await ownerOnly(slug);
    const briefId = await ensureTodayBrief(createAdminClient(), ctx.workspace.id);
    after(async () => {
      const out = await runStep(briefId);
      if (out.more) await chainStep(briefId);
    });
    revalidatePath(`/w/${slug}/brief`);
    return { ok: true, message: "Generando el brief de hoy: tarda unos minutos. Actualizá la página para ver el avance." };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

/** Reintenta un brief fallido desde el paso en que quedó (no repite lo ya hecho). */
export async function retryBriefNow(slug: string, briefId: string): Promise<ActionState> {
  try {
    const ctx = await ownerOnly(slug);
    const db = createAdminClient();
    const { data: b } = await db.from("briefs").select("id").eq("id", briefId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!b) return { message: "Brief no encontrado." };
    await retryBrief(db, briefId);
    after(async () => {
      const out = await runStep(briefId);
      if (out.more) await chainStep(briefId);
    });
    revalidatePath(`/w/${slug}/brief`);
    return { ok: true, message: "Reintentando desde el paso que falló." };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

/** Reenvía a los destinatarios con envío pendiente o fallido (mismo brief, sin repetir el research). */
export async function resendBrief(slug: string, briefId: string): Promise<ActionState> {
  try {
    const ctx = await ownerOnly(slug);
    const db = createAdminClient();
    const { data: b } = await db.from("briefs").select("id").eq("id", briefId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!b) return { message: "Brief no encontrado." };
    await db.from("brief_deliveries").update({ attempts: 0 }).eq("brief_id", briefId).eq("status", "fallido");
    const r = await deliverBrief(db, briefId, defaultEngines().email, { siteUrl: siteUrl() });
    revalidatePath(`/w/${slug}/brief`);
    return r.failed ? { message: `Enviados ${r.sent}, fallidos ${r.failed}: ${r.lastError}` } : { ok: true, message: r.sent ? `Enviado a ${r.sent} destinatario(s).` : "No había envíos pendientes." };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

/**
 * Candidato para el CRM: aprobar (empresa o persona se incorporan sin verificar, con la nota como fuente)
 * o descartar. Activos, fuentes y relaciones quedan aprobados para incorporarlos a mano.
 */
export async function decideCandidate(slug: string, candidateId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const decision = String(fd.get("decision") ?? "");
  if (!["aprobar", "descartar"].includes(decision)) return { message: "Elegí aprobar o descartar." };
  const supabase = await createClient();
  const { data: c } = await supabase.from("brief_candidates").select("id, kind, name, detail, source_url, status, payload").eq("id", candidateId).maybeSingle();
  if (!c) return { message: "Candidato no encontrado." };
  if (c.status !== "candidato") return { message: "Ya se decidió." };
  const decided = { decided_by: ctx.user.id, decided_at: new Date().toISOString() };
  if (decision === "descartar") {
    await supabase.from("brief_candidates").update({ status: "descartado", ...decided }).eq("id", candidateId);
    revalidatePath(`/w/${slug}/brief`, "layout");
    return { ok: true, message: "Descartado." };
  }
  let entityRef: string | null = null;
  if (c.kind === "empresa" || c.kind === "persona") {
    let sourceId: string | null = null;
    if (c.source_url) {
      const { data: existing } = await supabase.from("sources").select("id").eq("url", c.source_url).limit(1);
      sourceId = existing?.[0]?.id ?? null;
      if (!sourceId) {
        const { data: src, error } = await supabase.from("sources").insert({ workspace_id: ctx.workspace.id, kind: "research_externo", title: `Morning Brief · ${c.name}`.slice(0, 300), url: c.source_url, notes: "Detectada por el Morning Brief de RELEVO." }).select("id").single();
        if (error) return { message: dbErrorMessage(error) };
        sourceId = src.id;
      }
    }
    const notes = [c.detail, "Incorporada desde el Morning Brief (sin verificar)."].filter(Boolean).join("\n");
    if (c.kind === "empresa") {
      const { data, error } = await supabase.from("companies").insert({ workspace_id: ctx.workspace.id, trade_name: c.name, notes, verification_status: "unverified", source_id: sourceId }).select("id").single();
      if (error) return { message: dbErrorMessage(error) };
      entityRef = `company:${data.id}`;
    } else {
      const { data, error } = await supabase.from("contacts").insert({ workspace_id: ctx.workspace.id, full_name: c.name, notes, verification_status: "unverified", source_id: sourceId }).select("id").single();
      if (error) return { message: dbErrorMessage(error) };
      entityRef = `contact:${data.id}`;
    }
  }
  if (c.kind === "activo") {
    // Activo detectado → activo del Radar (sin verificar) con su primer precio como observación publicada.
    const p = (c.payload ?? {}) as { price?: number; currency?: "USD" | "ARS"; operation?: "venta" | "alquiler"; observed_on?: string; locality?: string | null; publisher?: string | null };
    const { data: a, error } = await supabase
      .from("assets")
      .insert({ workspace_id: ctx.workspace.id, kind: "inmueble", operation: p.operation ?? "desconocida", title: c.name, locality: p.locality ?? null, verification_status: "unverified", first_detected_on: p.observed_on ?? null, last_checked_on: p.observed_on ?? null, price_status: "sin_validar" })
      .select("id")
      .single();
    if (error) return { message: dbErrorMessage(error) };
    if (p.price && p.currency) {
      await supabase.from("asset_prices").insert({ workspace_id: ctx.workspace.id, asset_id: a.id, amount: p.price, currency: p.currency, operation: p.operation ?? "venta", observed_on: p.observed_on ?? null, source_url: c.source_url, publisher: p.publisher ?? null, origin: "brief", note: "Detectado por el Morning Brief" });
    }
    entityRef = `asset:${a.id}`;
  }
  await supabase.from("brief_candidates").update({ status: entityRef ? "incorporado" : "aprobado", entity_ref: entityRef, ...decided }).eq("id", candidateId);
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: entityRef ? "Incorporado al CRM (sin verificar)." : "Aprobado: queda para incorporar." };
}

/** "Qué haría RELEVO hoy" → tarea, solo si una persona lo decide. */
export async function actionToTask(slug: string, briefId: string, index: number): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { data: b } = await supabase.from("briefs").select("brief_date, content").eq("id", briefId).maybeSingle();
  const a = (b?.content as { actions?: { title: string; why: string }[] } | null)?.actions?.[index];
  if (!b || !a) return { message: "Acción no encontrada." };
  const { data: dup } = await supabase.from("tasks").select("id").eq("title", a.title).neq("status", "done").limit(1);
  if (dup?.length) return { message: "Ya hay una tarea abierta con ese título." };
  const { error } = await supabase.from("tasks").insert({ workspace_id: ctx.workspace.id, title: a.title, description: `${a.why}\n\nDel Morning Brief del ${b.brief_date}.`, assignee_id: ctx.user.id });
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: true, message: "Tarea creada (asignada a vos)." };
}

/** Seguir, poner en watchlist o cerrar una historia. */
export async function setStoryStatus(slug: string, storyId: string, status: "activa" | "watchlist" | "cerrada"): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return { message: "Tu rol es de solo lectura." };
  const supabase = await createClient();
  const { error } = await supabase.from("brief_stories").update({ status, updated_at: new Date().toISOString() }).eq("id", storyId);
  if (error) return { message: dbErrorMessage(error) };
  revalidatePath(`/w/${slug}/brief`, "layout");
  return { ok: true, message: status === "cerrada" ? "Historia cerrada." : status === "watchlist" ? "En watchlist." : "Historia activa." };
}
