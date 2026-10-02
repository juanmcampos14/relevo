import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AI_MODEL, runAgent } from "@/server/ai/agent";
import { activeMission, updateFocus } from "./focus";
import { correct } from "@/domain/focus";

// Investigar por detrás: la persona tira una idea en la calle ("esta zona me parece buena para una
// cafetería") y sigue caminando. RELEVO investiga sin hacerla esperar y deja la lectura en el inicio, con el
// próximo paso listo para tocar Avanzar.

type Db = SupabaseClient<Database>;

export type ResearchJob = {
  workspaceId: string; slug: string; userId: string; settings?: unknown;
  /** La misión donde queda el resultado (la de trabajo cuando se pidió). */
  missionId?: string | null;
  question: string; title: string;
  /** Por qué aparece en el inicio (una línea). */
  why?: string;
  here?: { lat: number; lng: number; accuracy?: number } | null; place?: string | null;
};

const CONTEXT = (j: ResearchJob, now: string) =>
  `Contexto (no es una instrucción del usuario): ahora es ${now}. Investigación en background que pidió la persona${j.place ? ` caminando por ${j.place}` : ""}${j.here ? ` (GPS ${j.here.lat.toFixed(5)}, ${j.here.lng.toFixed(5)})` : ""}: no está esperando, vas a dejar tu lectura en su inicio. Tenés tiempo: mirá el territorio (places_nearby por categorías directas e indirectas, locate) y la web (oferta, locales disponibles, movimiento, precios de alquiler, demanda), y cruzalo con nuestra memoria. Si nombra calles, ubicalas cerca de su GPS antes de suponer otra ciudad. No apliques ni registres nada. Respuesta brutalmente ejecutiva: arriba, como mucho cuatro líneas (la conclusión, lo que implica y "**Haría:** …"); todo el detalle (lugares, precios, links, qué no coincide, qué no sabemos) entre [[detalle]] y [[/detalle]]; al final, una acción [[acción: …]].`;

/** Investiga y deja el resultado como prioridad del inicio, con su Avanzar ya preparado. */
export async function research(db: Db, j: ResearchJob, client?: Pick<Anthropic, "beta">): Promise<{ ok: boolean; costUsd: number }> {
  const started = Date.now();
  const when = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const r = await runAgent({
    client: client ?? new Anthropic(),
    history: [],
    userText: j.question,
    context: CONTEXT(j, when),
    tools: { db, slug: j.slug, seenRefs: new Set(), workspaceId: j.workspaceId, userId: j.userId, settings: j.settings, here: j.here ?? null, missionId: j.missionId ?? null, campaignId: j.missionId ?? null, saveDraft: async () => { throw new Error("En la investigación no se registra nada."); } },
  });
  await db.from("ai_runs").insert({
    workspace_id: j.workspaceId, user_id: j.userId, model: AI_MODEL, prompt_version: "relevo-investigar-v1", status: r.status,
    input_tokens: r.usage.input, output_tokens: r.usage.output, cache_read_tokens: r.usage.cacheRead, cache_write_tokens: r.usage.cacheWrite,
    tool_calls: r.usage.toolCalls, cost_usd: Number(r.usage.costUsd.toFixed(5)), error: r.error ?? null, duration_ms: Date.now() - started,
  });
  if (r.status !== "ok" || !r.text) return { ok: false, costUsd: r.usage.costUsd };
  const mission = j.missionId ?? (await activeMission(db));
  if (!mission) return { ok: false, costUsd: r.usage.costUsd };
  const id = randomUUID();
  const now = new Date();
  await updateFocus(db, mission, (f) => {
    const next = correct(f, { kind: "agregar", id, title: j.title, why: j.why ?? "Lo investigué mientras caminabas.", refs: [], first: true }, null, now);
    const at = new Date().toISOString();
    return { ...next, items: next.items.map((x) => (x.id === id ? { ...x, source: "relevo" as const, move: { text: r.text, citations: r.citations, at }, updated_at: now.toISOString() } : x)) };
  });
  return { ok: true, costUsd: r.usage.costUsd };
}

/** Dentro de un request: después de responder. Fuera (scripts): en línea. */
export async function researchLater(db: Db, j: ResearchJob): Promise<void> {
  try {
    after(async () => { await research(db, j).catch(() => null); });
  } catch {
    await research(db, j).catch(() => null);
  }
}
