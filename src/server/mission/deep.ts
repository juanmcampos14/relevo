import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Trabajo profundo del Brain (background): puede tardar; corre antes de que el usuario entre. Los modelos
// son infraestructura: el producto nunca los nombra. Cada corrida queda registrada con costo y duración.

type Db = SupabaseClient<Database>;
export const DEEP_MODEL = "claude-opus-5-5";
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export type DeepResult<T> = { ok: true; value: T; runId: string | null; costUsd: number } | { ok: false; message: string };

export async function deepCall<S extends z.ZodType>(
  db: Db,
  opts: { workspaceId: string; promptVersion: string; system: string; prompt: string; schema: S; client?: Pick<Anthropic, "beta">; userId?: string | null; effort?: "low" | "medium" | "high" },
): Promise<DeepResult<z.infer<S>>> {
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, message: "La IA no está configurada en este entorno." };
  const started = Date.now();
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let value: z.infer<S> | null = null;
  let error: string | null = null;
  try {
    const client = opts.client ?? new Anthropic();
    const res = await client.beta.messages.parse({
      model: DEEP_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    usage = { input: res.usage.input_tokens ?? 0, output: res.usage.output_tokens ?? 0, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 };
    if (res.stop_reason === "refusal") error = "El modelo no respondió.";
    else if (!res.parsed_output) error = "La respuesta llegó incompleta.";
    else value = res.parsed_output as z.infer<S>;
  } catch (e) {
    error = e instanceof Anthropic.APIError ? `Error del proveedor de IA (${e.status}).` : `No se pudo completar: ${(e as Error).message}`;
  }
  const cost = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1_000_000;
  const { data: run } = await db
    .from("ai_runs")
    .insert({ workspace_id: opts.workspaceId, user_id: opts.userId ?? null, model: DEEP_MODEL, prompt_version: opts.promptVersion, status: value ? "ok" : "error", input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, cost_usd: Number(cost.toFixed(5)), error, duration_ms: Date.now() - started })
    .select("id")
    .single();
  return value ? { ok: true, value, runId: run?.id ?? null, costUsd: cost } : { ok: false, message: error ?? "Error" };
}
