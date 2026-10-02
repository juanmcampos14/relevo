// Tarifas por millón de tokens (USD), tomadas de platform.claude.com/docs/en/about-claude/pricing (2026-10-02).
// Una sola tabla para todo lo que registra costo en ai_runs: si cambia un precio, cambia acá.
// cacheWrite = escritura de 5 minutos (1,25×); cacheWrite1h = escritura de 1 hora (2×).

export type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number };

export const PRICES: Record<string, Rates> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
};

/** USD por búsqueda web ($10 cada 1.000); web_fetch no tiene cargo aparte. */
export const WEB_SEARCH_USD = 0.01;

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number; webSearches?: number };

export function ratesFor(model: string): Rates {
  return PRICES[model] ?? PRICES["claude-opus-5-5"];
}

/** Costo en USD. `cacheWrite` son todas las escrituras; `cacheWrite1h` es la parte que fue a 1 hora. */
export function costOf(model: string, u: TokenUsage): number {
  const r = ratesFor(model);
  const w1h = u.cacheWrite1h ?? 0;
  const w5m = Math.max(0, u.cacheWrite - w1h);
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + w5m * r.cacheWrite + w1h * r.cacheWrite1h) / 1_000_000 + (u.webSearches ?? 0) * WEB_SEARCH_USD;
}

type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

/** Suma el usage de una respuesta de la API a un acumulador. */
export function addUsage(acc: TokenUsage, u: ApiUsage): void {
  acc.input += u.input_tokens ?? 0;
  acc.output += u.output_tokens ?? 0;
  acc.cacheRead += u.cache_read_input_tokens ?? 0;
  acc.cacheWrite += u.cache_creation_input_tokens ?? 0;
  acc.cacheWrite1h = (acc.cacheWrite1h ?? 0) + (u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  acc.webSearches = (acc.webSearches ?? 0) + (u.server_tool_use?.web_search_requests ?? 0);
}
