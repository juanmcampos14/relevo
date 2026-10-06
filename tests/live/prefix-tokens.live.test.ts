// Cuánto pesa el contexto fijo de la conversación (sistema + herramientas). count_tokens es gratis.
// PREFIX=1 OUT=prefix.json npx vitest run tests/live/prefix-tokens.live.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { describe, it } from "vitest";
import { AI_MODEL, SYSTEM_PROMPT } from "@/server/ai/agent";
import { TOOL_DEFINITIONS } from "@/server/ai/tools";

describe.skipIf(!process.env.PREFIX)("contexto fijo", () => {
  it("cuenta", { timeout: 60_000 }, async () => {
    const c = new Anthropic();
    const msg = [{ role: "user" as const, content: "hola" }];
    const base = await c.beta.messages.countTokens({ model: AI_MODEL, messages: msg });
    const sys = await c.beta.messages.countTokens({ model: AI_MODEL, system: SYSTEM_PROMPT, messages: msg });
    const tools = await c.beta.messages.countTokens({ model: AI_MODEL, tools: TOOL_DEFINITIONS, messages: msg });
    const per = await Promise.all(TOOL_DEFINITIONS.map(async (t) => [t.name, (await c.beta.messages.countTokens({ model: AI_MODEL, tools: [t], messages: msg })).input_tokens - base.input_tokens] as const));
    (await import("node:fs")).writeFileSync(process.env.OUT ?? "prefix.json", JSON.stringify({ model: AI_MODEL, sistema: sys.input_tokens - base.input_tokens, herramientas: tools.input_tokens - base.input_tokens, cantidad: TOOL_DEFINITIONS.length, mas_pesadas: per.sort((a, b) => b[1] - a[1]).slice(0, 12) }));
  });
});
