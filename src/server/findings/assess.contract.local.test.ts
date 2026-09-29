// Contrato con la API real: RUN_CONTRACT=1 npx vitest run src/server/findings/assess.contract.local.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const run = process.env.RUN_CONTRACT === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!run)("evaluación de finding contra la API real", () => {
  it("la API acepta el esquema", async () => {
    const { AssessmentSchema } = await import("./assess");
    const r = await new Anthropic().beta.messages.create({
      model: "claude-opus-5-5", max_tokens: 16,
      output_config: { format: { type: "json_schema", schema: betaZodOutputFormat(AssessmentSchema).schema } },
      messages: [{ role: "user", content: "Finding: faltan locales. Sin evidencia." }],
    } as never);
    expect((r as { stop_reason: string }).stop_reason).toBe("max_tokens");
  }, 120_000);
});
