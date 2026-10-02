import { describe, expect, it } from "vitest";
import { addUsage, costOf, type TokenUsage } from "./pricing";

describe("costos de IA", () => {
  it("cobra cada tipo de token a su tarifa, con las búsquedas web aparte", () => {
    const u: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    addUsage(u, { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 300_000, cache_creation: { ephemeral_1h_input_tokens: 100_000 }, server_tool_use: { web_search_requests: 3 } });
    // Opus 5.5: 4 + 2 + 0,2 + 200k×5 + 100k×8 = 4 + 2 + 0,2 + 1 + 0,8 = 8 ; + 3 búsquedas × 0,01
    expect(costOf("claude-opus-5-5", u)).toBeCloseTo(8.03, 5);
    expect(costOf("claude-sonnet-5-5", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(12, 5);
  });
});
