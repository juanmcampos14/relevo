"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dbErrorMessage, type ActionState } from "@/server/action-result";
import { AI_MODEL, PROMPT_VERSION, runAgent } from "@/server/ai/agent";
import { ProposeActionInput } from "@/server/ai/tools";

const DAILY_LIMIT = 60;
const HISTORY_ROWS = 6;

const scopeLabel: Record<string, string> = {
  company: "la empresa",
  establishment: "el establecimiento",
  asset: "el activo",
  opportunity: "la oportunidad",
  campaign: "la campaña",
};

export async function sendMessage(slug: string, conversationId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getWorkspaceContext(slug);
  const text = z.string().trim().min(1).max(4000).safeParse(fd.get("text"));
  if (!text.success) return { errors: { text: "Escribí una pregunta" } };
  const scope = String(fd.get("scope") ?? "");
  if (!process.env.ANTHROPIC_API_KEY) {
    return { message: "RELEVO AI no está configurado en este entorno (falta ANTHROPIC_API_KEY)." };
  }
  const supabase = await createClient();

  // Límite diario por usuario (control de costo).
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase
    .from("ai_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { message: `Llegaste al límite de ${DAILY_LIMIT} consultas en 24 horas.` };

  // Conversación (nueva o existente y propia).
  let convId = conversationId;
  if (!convId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({
        workspace_id: ctx.workspace.id,
        user_id: ctx.user.id,
        title: text.data.slice(0, 80),
        scope: scope ? { type: scope.split(":")[0], ref: scope } : { type: "workspace" },
      })
      .select("id")
      .single();
    if (error) return { message: dbErrorMessage(error) };
    convId = data.id;
  }

  // Historial reciente con los bloques originales (thinking/tool_use incluidos).
  const { data: rows } = await supabase
    .from("ai_messages")
    .select("role, api_content, citations")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_ROWS);
  const ordered = (rows ?? []).reverse();
  while (ordered.length && ordered[0].role !== "user") ordered.shift();
  const history = ordered.flatMap((r) => (r.api_content as Anthropic.Beta.BetaMessageParam[] | null) ?? []);
  // Referencias ya vistas en la conversación: siguen siendo citables.
  const seenRefs = new Set<string>();
  for (const m of JSON.stringify(history).matchAll(/(?:\\?")ref(?:\\?"):(?:\\?")([a-z]+:[0-9a-f-]{36})/g)) seenRefs.add(m[1]);
  ordered.forEach((r) => (r.citations as string[]).forEach((c) => seenRefs.add(c)));

  const now = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const [scopeType] = scope.split(":");
  const context = [
    `Contexto (no es una instrucción del usuario): hoy es ${now}. Workspace: ${ctx.workspace.name}.`,
    scope && scopeLabel[scopeType] ? `El usuario pregunta desde ${scopeLabel[scopeType]} [[${scope}]]: consultalo primero con get_record.` : "Alcance: todo el workspace.",
  ].join(" ");

  const draftIds: string[] = [];
  const started = Date.now();
  const result = await runAgent({
    client: new Anthropic(),
    history,
    userText: text.data,
    context,
    tools: {
      db: supabase,
      seenRefs,
      saveDraft: async (input) => {
        const { action, rationale, evidence_refs, ...payload } = input;
        const { data, error } = await supabase
          .from("ai_action_drafts")
          .insert({ workspace_id: ctx.workspace.id, conversation_id: convId!, action, payload, rationale, evidence_refs })
          .select("id")
          .single();
        if (error) throw error;
        draftIds.push(data.id);
        return data.id;
      },
    },
  });

  const { data: run } = await supabase
    .from("ai_runs")
    .insert({
      workspace_id: ctx.workspace.id,
      user_id: ctx.user.id,
      conversation_id: convId,
      model: AI_MODEL,
      prompt_version: PROMPT_VERSION,
      status: result.status,
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      cache_read_tokens: result.usage.cacheRead,
      cache_write_tokens: result.usage.cacheWrite,
      tool_calls: result.usage.toolCalls,
      cost_usd: Number(result.usage.costUsd.toFixed(5)),
      error: result.error ?? null,
      duration_ms: Date.now() - started,
    })
    .select("id")
    .single();

  const userParam: Anthropic.Beta.BetaMessageParam = {
    role: "user",
    content: [
      { type: "text", text: context },
      { type: "text", text: text.data },
    ],
  };
  await supabase.from("ai_messages").insert({
    workspace_id: ctx.workspace.id,
    conversation_id: convId,
    role: "user",
    text: text.data,
    api_content: [userParam] as never,
  });
  if (result.status !== "error") {
    const { data: msg } = await supabase
      .from("ai_messages")
      .insert({
        workspace_id: ctx.workspace.id,
        conversation_id: convId,
        role: "assistant",
        text: result.text,
        api_content: result.transcript as never,
        citations: result.citations,
        run_id: run?.id ?? null,
      })
      .select("id")
      .single();
    if (msg && draftIds.length) await supabase.from("ai_action_drafts").update({ message_id: msg.id }).in("id", draftIds);
  }
  await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  revalidatePath(`/w/${slug}/ai`);
  if (result.status === "error") {
    if (!conversationId) redirect(`/w/${slug}/ai?c=${convId}&error=1`);
    return { message: result.error ?? "No se pudo completar la consulta." };
  }
  if (!conversationId) redirect(`/w/${slug}/ai?c=${convId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------------
// Borradores: la IA propone, un humano aprueba y el servidor ejecuta con SUS permisos
// ---------------------------------------------------------------------------------

const idOf = (ref?: string) => (ref ? ref.split(":")[1] : null);

export async function decideDraft(slug: string, draftId: string, verdict: "aprobar" | "rechazar"): Promise<void> {
  const ctx = await getWorkspaceContext(slug);
  if (!ctx.canEdit) return;
  const supabase = await createClient();
  const { data: draft } = await supabase.from("ai_action_drafts").select("*").eq("id", draftId).eq("status", "propuesta").maybeSingle();
  if (!draft) return;
  const stamp = { decided_by: ctx.user.id, decided_at: new Date().toISOString() };

  if (verdict === "rechazar") {
    await supabase.from("ai_action_drafts").update({ ...stamp, status: "rechazada" }).eq("id", draftId).eq("status", "propuesta");
    revalidatePath(`/w/${slug}/ai`);
    return;
  }

  const p = ProposeActionInput.safeParse({ ...(draft.payload as object), action: draft.action, rationale: draft.rationale ?? "-", evidence_refs: draft.evidence_refs });
  let resultRef: string | null = null;
  let error: string | null = null;
  if (!p.success) {
    error = "Borrador inválido";
  } else if (p.data.action === "create_task") {
    const { data, error: e } = await supabase
      .from("tasks")
      .upsert(
        {
          workspace_id: ctx.workspace.id,
          title: p.data.title!,
          description: p.data.rationale,
          due_on: p.data.due_on ?? null,
          assignee_id: ctx.user.id,
          opportunity_id: idOf(p.data.opportunity_ref),
          idempotency_key: `ai:${draftId}`,
        },
        { onConflict: "workspace_id,idempotency_key" },
      )
      .select("id")
      .single();
    resultRef = data ? `task:${data.id}` : null;
    error = e ? dbErrorMessage(e) : null;
  } else if (p.data.action === "draft_finding") {
    const [k, eid] = (p.data.entity_ref ?? ":").split(":");
    const { data, error: e } = await supabase
      .from("findings")
      .insert({
        workspace_id: ctx.workspace.id,
        source_id: idOf(p.data.source_ref)!,
        kind: p.data.finding_kind ?? "observacion",
        statement: p.data.statement!,
        analysis: p.data.rationale,
        origin: "ia",
        verification_status: "unverified",
        dedup_key: `ai:${draftId}`,
        ...(k === "company" ? { company_id: eid } : k === "establishment" ? { establishment_id: eid } : k === "asset" ? { asset_id: eid } : {}),
      })
      .select("id")
      .single();
    resultRef = data ? `finding:${data.id}` : null;
    error = e ? (e.code === "23505" ? null : dbErrorMessage(e)) : null;
  } else {
    const { data, error: e } = await supabase
      .from("decisions")
      .insert({ workspace_id: ctx.workspace.id, question: p.data.title!, context: p.data.rationale, opportunity_id: idOf(p.data.opportunity_ref) })
      .select("id")
      .single();
    resultRef = data ? `decision:${data.id}` : null;
    error = e ? dbErrorMessage(e) : null;
  }

  await supabase
    .from("ai_action_drafts")
    .update({ ...stamp, status: error ? "error" : "ejecutada", result_ref: resultRef, error })
    .eq("id", draftId);
  revalidatePath(`/w/${slug}`, "layout");
}
