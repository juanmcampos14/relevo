import * as z from "zod/v4";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { ExtractionSchema, WireSchema, fromWire } = await import("./extract");

describe("esquema hacia la API", () => {
  it("ningún texto viaja como 'o null' (agranda la gramática por encima del límite)", () => {
    const nullableText = /"type":\["string","null"\]/;
    expect(JSON.stringify(z.toJSONSchema(ExtractionSchema))).toMatch(nullableText);
    const json = JSON.stringify(z.toJSONSchema(WireSchema));
    expect(json).not.toMatch(nullableText);
    expect(json).toContain('"surface_m2"');
  });

  it("'' vuelve como null y el resultado es una Extraction válida", () => {
    const back = fromWire({
      summary: "Local", company: null,
      asset: { title: "Local", kind: "local", operation: "alquiler", address_text: "", locality: " ", surface_m2: 60 },
      people: [{ key: "p1", name: "", role: "encargado", institutional: true, existing_id: "", resolves: "" }],
      evidence: [{ key: "e1", statement: "60 m²", quote: "60 metros", evidence_type: "dato", origin: "declarado_por_documento", stated_by: "", declared_by: "cartel", about: "asset" }],
      finding_candidates: [{ statement: "Posible…", existing_finding_id: "", relation: "nueva", refined_statement: "", is_idea: true, kind: "necesidad", rationale: "", supports: ["e1"], contradicts: [] }],
      unknowns: ["Quién decide"],
      next_actions: [{ title: "Llamar", why: "", contact: "", due: "" }],
    });
    const x = ExtractionSchema.parse(back);
    expect(x.asset).toMatchObject({ address_text: null, locality: null, surface_m2: 60 });
    expect(x.people[0]).toMatchObject({ name: null, existing_id: null, resolves: null });
    expect(x.evidence[0]).toMatchObject({ stated_by: null, declared_by: "cartel" });
    expect(x.finding_candidates[0]).toMatchObject({ existing_finding_id: null, refined_statement: null, is_idea: true });
    expect(x.next_actions[0]).toMatchObject({ contact: null, due: null, why: "" });
  });
});
