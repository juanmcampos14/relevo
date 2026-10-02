import "server-only";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { addUsage, costOf, type TokenUsage } from "@/server/ai/pricing";

// Trabajo profundo del Brain (background): puede tardar; corre antes de que el usuario entre. Los modelos
// son infraestructura: el producto nunca los nombra. Cada corrida queda registrada con costo y duración.

type Db = SupabaseClient<Database>;
export const DEEP_MODEL = "claude-opus-5-5";
export type DeepModel = "claude-opus-5-5" | "claude-sonnet-5-5";

export type DeepResult<T> = { ok: true; value: T; runId: string | null; costUsd: number } | { ok: false; message: string };

export async function deepCall<S extends z.ZodType>(
  db: Db,
  opts: { workspaceId: string; promptVersion: string; system: string; prompt: string; schema: S; client?: Pick<Anthropic, "beta">; userId?: string | null; effort?: "low" | "medium" | "high"; model?: DeepModel },
): Promise<DeepResult<z.infer<S>>> {
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, message: "La IA no está configurada en este entorno." };
  const started = Date.now();
  const model = opts.model ?? DEEP_MODEL;
  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let value: z.infer<S> | null = null;
  let error: string | null = null;
  try {
    const client = opts.client ?? new Anthropic();
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      // Las corridas de un mismo trabajo comparten el sistema (p. ej. una por misión): se cachea.
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.prompt }],
    });
    addUsage(usage, res.usage);
    if (res.stop_reason === "refusal") error = "El modelo no respondió.";
    else if (!res.parsed_output) error = "La respuesta llegó incompleta.";
    else value = res.parsed_output as z.infer<S>;
  } catch (e) {
    error = e instanceof Anthropic.APIError ? `Error del proveedor de IA (${e.status}).` : `No se pudo completar: ${(e as Error).message}`;
  }
  const cost = costOf(model, usage);
  const { data: run } = await db
    .from("ai_runs")
    .insert({ workspace_id: opts.workspaceId, user_id: opts.userId ?? null, model, prompt_version: opts.promptVersion, status: value ? "ok" : "error", input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, cost_usd: Number(cost.toFixed(5)), error, duration_ms: Date.now() - started })
    .select("id")
    .single();
  return value ? { ok: true, value, runId: run?.id ?? null, costUsd: cost } : { ok: false, message: error ?? "Error" };
}

/** Huella de lo que el modelo leería: si no cambió, no se vuelve a pagar el mismo trabajo. */
export function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}
