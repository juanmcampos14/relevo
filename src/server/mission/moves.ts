import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { moveIsFresh, visible } from "@/domain/focus";
import { AI_MODEL, runAgent } from "@/server/ai/agent";
import { SIGNATURE, loadFocus, updateFocus } from "./focus";

// "RELEVO ya trabajó" también para Avanzar: lo que se ve en el home llega con su próximo paso preparado
// (persona encontrada, mensaje listo), así en la calle tocar Avanzar responde al instante.

type Db = SupabaseClient<Database>;

const PREPARE_CONTEXT = (now: string) =>
  `Contexto (no es una instrucción del usuario): ahora es ${now}. Estás preparando en background el "Avanzar" de una prioridad del día del equipo, antes de que la persona lo toque: cuando lo toque, verá esta respuesta al instante. Tenés tiempo: si falta la persona correcta, buscala ahora (memoria y web: quién es el responsable comercial, de compras o el dueño, y por qué canal) antes de responder. No apliques ni registres nada: esto es solo la preparación; si hace falta una acción, dejala como botón. Los mensajes listos se firman con la marca ${SIGNATURE} (se reemplaza por el nombre de quien lo manda).`;

/**
 * Prepara el Avanzar de lo que hoy se ve en el home (como mucho tres): misma voz y mismas herramientas que
 * la conversación, sin aplicar nada. Cada corrida queda registrada con su costo.
 */
export async function prepareMoves(db: Db, opts: { workspaceId: string; campaignId: string; slug: string; settings?: unknown; userId?: string | null; client?: Pick<Anthropic, "beta">; max?: number }) {
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { prepared: 0, costUsd: 0 };
  const focus = await loadFocus(db, opts.campaignId);
  const now = new Date();
  const todo = visible(focus, now, opts.max ?? 3).filter((x) => !moveIsFresh(x, now));
  let cost = 0;
  let prepared = 0;
  const when = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(now);
  for (const it of todo) {
    const started = Date.now();
    const seenRefs = new Set<string>(it.refs);
    const r = await runAgent({
      client: opts.client ?? new Anthropic(),
      history: [],
      userText: `Avanzar: ${it.title}`,
      context: PREPARE_CONTEXT(when),
      tools: {
        db, slug: opts.slug, seenRefs, background: true, missionId: opts.campaignId, workspaceId: opts.workspaceId, userId: opts.userId ?? undefined, settings: opts.settings, campaignId: opts.campaignId,
        saveDraft: async () => { throw new Error("En la preparación no se registra nada: dejalo como botón."); },
      },
    });
    cost += r.usage.costUsd;
    await db.from("ai_runs").insert({
      workspace_id: opts.workspaceId, user_id: opts.userId ?? null, model: AI_MODEL, prompt_version: "relevo-avanzar-preparado-v1", status: r.status,
      input_tokens: r.usage.input, output_tokens: r.usage.output, cache_read_tokens: r.usage.cacheRead, cache_write_tokens: r.usage.cacheWrite,
      tool_calls: r.usage.toolCalls, cost_usd: Number(r.usage.costUsd.toFixed(5)), error: r.error ?? null, duration_ms: Date.now() - started,
    });
    if (r.status !== "ok" || !r.text) continue;
    const at = new Date().toISOString();
    // Si mientras tanto la prioridad cambió (se hizo, se sacó, se reescribió), esta preparación ya no sirve.
    await updateFocus(db, opts.campaignId, (f) => {
      const cur = f.items.find((x) => x.id === it.id);
      if (!cur || cur.updated_at !== it.updated_at || cur.status !== it.status) return f;
      return { ...f, items: f.items.map((x) => (x.id === it.id ? { ...x, move: { text: r.text, citations: r.citations, at } } : x)) };
    });
    prepared++;
  }
  return { prepared, costUsd: cost };
}

