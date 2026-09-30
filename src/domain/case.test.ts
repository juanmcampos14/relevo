import { describe, expect, it } from "vitest";
import { caseStage, opportunityCriteria } from "./case";

const dim = (key: string, status: string, summary = key) => ({ key, status, summary, evidence_ids: [] }) as never;

describe("caso en estudio", () => {
  it("etapa: señal → en validación → caso → oportunidad", () => {
    expect(caseStage({ maturity: "hipotesis", independentCases: 1, hasOpportunity: false })).toBe("senal");
    expect(caseStage({ maturity: "hipotesis", independentCases: 2, hasOpportunity: false })).toBe("en_validacion");
    expect(caseStage({ maturity: "caso", independentCases: 2, hasOpportunity: false })).toBe("caso");
    expect(caseStage({ maturity: "caso", independentCases: 2, hasOpportunity: true })).toBe("oportunidad");
    expect(caseStage({ maturity: "idea", independentCases: 0, hasOpportunity: false })).toBe("idea");
  });

  it("un caso con dos casos, economía declarada y sin comprador no cumple: lo dice y por qué", () => {
    const r = opportunityCriteria({
      dims: [dim("problema", "sabido", "Contratistas sin vianda reintegran comidas"), dim("actor_afectado", "sabido"), dim("comprador", "falta")],
      gaps: ["falta_comprador"],
      metrics: { independentCases: 2, contradicts: 1 },
      economics: [{ variable: "precio", value: "hasta $18.000 por comida", basis: "declarado", formula: null, evidence_ids: ["e1"] }, { variable: "margen", value: "30%", basis: "estimado", formula: null, evidence_ids: [] }],
      nextMilestone: "Hablar con compras de la contratista",
    });
    expect(r.met).toBe(false);
    expect(r.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(["comprador"]);
    expect(r.items.find((i) => i.key === "economia")!.detail).toBe("hasta $18.000 por comida");
  });

  it("una contradicción sin resolver impide 'evidencia suficiente'", () => {
    const r = opportunityCriteria({ dims: [], gaps: ["contradiccion_sin_resolver"], metrics: { independentCases: 3, contradicts: 2 }, economics: [], nextMilestone: null });
    expect(r.items.find((i) => i.key === "evidencia")).toMatchObject({ ok: false, detail: "3 casos independientes · 2 en contra sin resolver." });
  });
});
