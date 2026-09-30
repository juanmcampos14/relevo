import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AI_MODEL, PROMPT_VERSION, runAgent } from "./agent";
import { previewDraft } from "./drafts";

// Un turno de conversación con RELEVO: lo usan la página de RELEVO AI y el panel persistente.
// Mismo motor, mismas herramientas, mismos permisos (el cliente del usuario → RLS).

type Db = SupabaseClient<Database>;
const DAILY_LIMIT = 60;
const HISTORY_ROWS = 6;

const scopeLabel: Record<string, string> = {
  company: "la empresa",
  establishment: "el establecimiento",
  asset: "el activo",
  opportunity: "la oportunidad",
  campaign: "la campaña",
  finding: "la hipótesis",
  capture: "la captura",
  contact: "la persona",
};
const scopeTool: Record<string, string> = { finding: "get_hypothesis", capture: "get_capture", contact: "get_person" };

export type TurnResult =
  | { ok: true; conversationId: string; text: string; citations: string[]; draftIds: string[]; navigate: string | null }
  | { ok: false; conversationId: string | null; message: string };

export async function runTurn(
  db: Db,
  opts: { slug: string; workspaceId: string; workspaceName: string; userId: string; conversationId: string | null; text: string; scope: string; screen?: string; client?: Pick<Anthropic, "beta"> },
): Promise<TurnResult> {
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, conversationId: opts.conversationId, message: "RELEVO AI no está configurado en este entorno (falta ANTHROPIC_API_KEY)." };
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).eq("user_id", opts.userId).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, conversationId: opts.conversationId, message: `Llegaste al límite de ${DAILY_LIMIT} consultas en 24 horas.` };

  let convId = opts.conversationId;
  if (!convId) {
    const { data, error } = await db
      .from("ai_conversations")
      .insert({ workspace_id: opts.workspaceId, user_id: opts.userId, title: opts.text.slice(0, 80), scope: opts.scope ? { type: opts.scope.split(":")[0], ref: opts.scope } : { type: "workspace" } })
      .select("id")
      .single();
    if (error) return { ok: false, conversationId: null, message: error.message };
    convId = data.id;
  }

  const { data: rows } = await db.from("ai_messages").select("role, api_content, citations").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(HISTORY_ROWS);
  const ordered = (rows ?? []).reverse();
  while (ordered.length && ordered[0].role !== "user") ordered.shift();
  const history = ordered.flatMap((r) => (r.api_content as Anthropic.Beta.BetaMessageParam[] | null) ?? []);
  const seenRefs = new Set<string>();
  for (const m of JSON.stringify(history).matchAll(/(?:\\?")ref(?:\\?"):(?:\\?")([a-z]+:[0-9a-f-]{36})/g)) seenRefs.add(m[1]);
  ordered.forEach((r) => (r.citations as string[]).forEach((c) => seenRefs.add(c)));
  // La entidad de la pantalla actual es consultable (y citable) sin buscarla.
  if (opts.scope) seenRefs.add(opts.scope);

  const now = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const [scopeType] = opts.scope.split(":");
  const context = [
    `Contexto (no es una instrucción del usuario): ahora es ${now}. Workspace: ${opts.workspaceName}.`,
    opts.screen ? `Pantalla actual: ${opts.screen}.` : null,
    opts.scope && scopeLabel[scopeType]
      ? `El usuario está mirando ${scopeLabel[scopeType]} [[${opts.scope}]]: si la pregunta se refiere a "esto", "acá" o no nombra otra cosa, es sobre eso (consultalo primero con ${scopeTool[scopeType] ?? "get_record"}). Podés consultar el resto de la memoria cuando haga falta.`
      : "Alcance: todo el workspace.",
  ].filter(Boolean).join(" ");

  const draftIds: string[] = [];
  let navigate: string | null = null;
  const started = Date.now();
  const result = await runAgent({
    client: opts.client ?? new Anthropic(),
    history,
    userText: opts.text,
    context,
    tools: {
      db,
      slug: opts.slug,
      seenRefs,
      navigate: (href) => { navigate = href; },
      saveDraft: async (input) => {
        const { action, rationale, evidence_refs, ...payload } = input;
        const preview = await previewDraft(db, input);
        const { data, error } = await db
          .from("ai_action_drafts")
          .insert({ workspace_id: opts.workspaceId, conversation_id: convId!, action, payload, rationale, evidence_refs, preview: preview as never })
          .select("id")
          .single();
        if (error) throw error;
        draftIds.push(data.id);
        return data.id;
      },
    },
  });

  const { data: run } = await db
    .from("ai_runs")
    .insert({
      workspace_id: opts.workspaceId, user_id: opts.userId, conversation_id: convId, model: AI_MODEL, prompt_version: PROMPT_VERSION, status: result.status,
      input_tokens: result.usage.input, output_tokens: result.usage.output, cache_read_tokens: result.usage.cacheRead, cache_write_tokens: result.usage.cacheWrite,
      tool_calls: result.usage.toolCalls, cost_usd: Number(result.usage.costUsd.toFixed(5)), error: result.error ?? null, duration_ms: Date.now() - started,
    })
    .select("id")
    .single();

  const userParam: Anthropic.Beta.BetaMessageParam = { role: "user", content: [{ type: "text", text: context }, { type: "text", text: opts.text }] };
  await db.from("ai_messages").insert({ workspace_id: opts.workspaceId, conversation_id: convId, role: "user", text: opts.text, api_content: [userParam] as never });
  if (result.status !== "error") {
    const { data: msg } = await db
      .from("ai_messages")
      .insert({ workspace_id: opts.workspaceId, conversation_id: convId, role: "assistant", text: result.text, api_content: result.transcript as never, citations: result.citations, run_id: run?.id ?? null })
      .select("id")
      .single();
    if (msg && draftIds.length) await db.from("ai_action_drafts").update({ message_id: msg.id }).in("id", draftIds);
  }
  await db.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
  if (result.status === "error") return { ok: false, conversationId: convId, message: result.error ?? "No se pudo completar la consulta." };
  return { ok: true, conversationId: convId!, text: result.text, citations: result.citations, draftIds, navigate };
}
