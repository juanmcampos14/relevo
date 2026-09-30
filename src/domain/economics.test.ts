import { describe, expect, it } from "vitest";
import { sanitizeEconomics, unknownEconomics } from "./economics";

describe("economía de un caso", () => {
  const ev = new Set(["e1", "e2"]);
  const out = sanitizeEconomics([
    { variable: "usuarios", value: "unas 35 personas", basis: "declarado", formula: null, evidence_ids: ["e1"] },
    { variable: "precio", value: "hasta $18.000 por comida", basis: "declarado", formula: null, evidence_ids: ["e2", "inventada"] },
    { variable: "volumen", value: "$630.000 por día sin vianda", basis: "calculado", formula: "35 × $18.000", evidence_ids: ["e1", "e2"] },
    { variable: "frecuencia", value: "todas las semanas", basis: "declarado", formula: null, evidence_ids: [] },
    { variable: "margen", value: "30%", basis: "calculado", formula: null, evidence_ids: [] },
    { variable: "usuarios", value: "otra vez", basis: "observado", formula: null, evidence_ids: ["e1"] },
  ], ev);

  it("declarado u observado exige evidencia real; calculado exige fórmula; sin eso es estimado", () => {
    expect(out.map((f) => [f.variable, f.basis])).toEqual([["usuarios", "declarado"], ["frecuencia", "estimado"], ["volumen", "calculado"], ["precio", "declarado"], ["margen", "estimado"]]);
    expect(out.find((f) => f.variable === "precio")!.evidence_ids).toEqual(["e2"]);
  });

  it("lo que no figura es desconocido", () => {
    expect(unknownEconomics(out)).toEqual(["pagador", "comprador", "proveedor_actual", "contrato", "capex", "opex", "condicion_cambio"]);
  });
});
