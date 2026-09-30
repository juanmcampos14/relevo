// Ciclo del agente con un cliente de Anthropic simulado: herramientas, citas,
// borradores (sin ejecutar nada) y cierre de tool_use pendientes.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { runAgent, sanitizeCitations } from "./agent";
import type { ToolContext } from "./tools";

const EST = "11111111-1111-4111-8111-111111111111";
const FAKE = "99999999-9999-4999-8999-999999999999";

type Msg = Anthropic.Beta.BetaMessage;
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } as Anthropic.Beta.BetaUsage;
const msg = (stop: Msg["stop_reason"], content: unknown[]): Msg => ({ stop_reason: stop, content, usage }) as unknown as Msg;

function fakeClient(responses: Msg[]) {
  const create = vi.fn(async () => responses.shift()!);
  return { client: { beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">, create };
}

function fakeTools(): ToolContext & { drafts: unknown[] } {
  const drafts: unknown[] = [];
  const row = { id: EST, name: "Parador Ruta 7", address_text: "Ruta 7", locality: "Añelo", address_status: "no_verificada", verification_status: "unverified", is_demo: true, notes: null, company_id: null };
  const empty = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "limit", "order", "in", "gte", "or", "ilike"]) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: row, error: null });
  chain.then = (res: (v: unknown) => unknown) => res(empty);
  return {
    db: { from: () => chain } as unknown as ToolContext["db"],
    slug: "daicou",
    seenRefs: new Set(),
    drafts,
    saveDraft: async (d) => {
      drafts.push(d);
      return "draft-1";
    },
  };
}

describe("RELEVO AI", () => {
  it("consulta, cita solo lo que vio y marca referencias inventadas", async () => {
    const { client, create } = fakeClient([
      msg("tool_use", [{ type: "tool_use", id: "t1", name: "get_record", input: { ref: `establishment:${EST}` } }]),
      msg("end_turn", [{ type: "text", text: `El parador [[establishment:${EST}]] no tiene visitas. Otro dato [[finding:${FAKE}]].` }]),
    ]);
    const tools = fakeTools();
    const r = await runAgent({ client, history: [], userText: "¿Qué sabemos del parador?", context: "ctx", tools });
    expect(r.status).toBe("ok");
    expect(r.citations).toEqual([`establishment:${EST}`]);
    expect(r.text).toContain("[referencia no verificada]");
    expect(r.text).not.toContain(FAKE);
    expect(r.usage.toolCalls).toBe(1);
    expect(r.usage.costUsd).toBeGreaterThan(0);
    // Prompt de sistema estable, fallbacks y caché en cada llamada.
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: "claude-opus-5", fallbacks: "default", cache_control: { type: "ephemeral" } });
    expect(String(params.system)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("propose_action solo registra un borrador y rechaza referencias no consultadas", async () => {
    const { client } = fakeClient([
      msg("tool_use", [
        { type: "tool_use", id: "t1", name: "propose_action", input: { action: "create_task", title: "Visitar", rationale: "r", evidence_refs: [`establishment:${EST}`] } },
      ]),
      msg("tool_use", [{ type: "tool_use", id: "t2", name: "get_record", input: { ref: `establishment:${EST}` } }]),
      msg("tool_use", [
        { type: "tool_use", id: "t3", name: "propose_action", input: { action: "create_task", title: "Visitar", rationale: "r", evidence_refs: [`establishment:${EST}`] } },
      ]),
      msg("end_turn", [{ type: "text", text: "Dejé un borrador de tarea para aprobar." }]),
    ]);
    const tools = fakeTools();
    const r = await runAgent({ client, history: [], userText: "Creá una tarea", context: "ctx", tools });
    expect(tools.drafts).toHaveLength(1);
    const firstResult = (r.transcript[1].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(firstResult.is_error).toBe(true);
    expect(String(firstResult.content)).toMatch(/no salieron de ninguna consulta/);
  });

  it("al cortar por límite cierra los tool_use pendientes para no romper el próximo turno", async () => {
    const loop = Array.from({ length: 12 }, (_, i) => msg("tool_use", [{ type: "tool_use", id: `t${i}`, name: "campaign_overview", input: {} }]));
    const { client } = fakeClient(loop);
    const r = await runAgent({ client, history: [], userText: "?", context: "ctx", tools: fakeTools() });
    expect(r.status).toBe("limit");
    const last = r.transcript[r.transcript.length - 1];
    expect(last.role).toBe("user");
    expect((last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0].type).toBe("tool_result");
  });

  it("maneja la negativa del modelo sin inventar respuesta", async () => {
    const { client } = fakeClient([msg("refusal", [])]);
    const r = await runAgent({ client, history: [], userText: "x", context: "ctx", tools: fakeTools() });
    expect(r.status).toBe("refused");
  });

  it("sanitizeCitations deja solo referencias vistas", () => {
    const s = sanitizeCitations(`a [[visit:${EST}]] b [[visit:${FAKE}]]`, new Set([`visit:${EST}`]));
    expect(s.citations).toEqual([`visit:${EST}`]);
    expect(s.text).toBe(`a [[visit:${EST}]] b [referencia no verificada]`);
  });
});
