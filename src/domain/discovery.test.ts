import { describe, expect, it } from "vitest";
import { sanitizeDiscovery } from "./discovery";

const seen = {
  evidence: new Set(["evidence:e1"]),
  signals: new Set(["signal:s1"]),
  questions: new Set(["question:q1"]),
  people: new Map([["contact:c1", "Martín · Hotel"], ["company:k1", "Hotel"]]),
};
const raw = {
  belief: " La vacancia rota más de lo que muestra el inventario. ",
  why: "Dos operadores lo declararon.",
  evidence_level: "alta",
  evidence_summary: "Dos declaraciones.",
  evidence_refs: ["evidence:e1", "evidence:inventada"],
  signal_refs: ["signal:s1", "signal:otra"],
  question_refs: ["question:q1", "question:x"],
  who_can_help: [
    { ref: "contact:c1", purpose: "inteligencia", why: "Opera camas", ask: "¿Cuánto dura una asignación?" },
    { ref: "contact:inventado", purpose: "vender_crear", why: "x", ask: "y" },
    { ref: "company:k1", purpose: "raro", why: "Dueño", ask: "¿Vendería?" },
  ],
};

describe("discovery de una hipótesis", () => {
  it("solo conserva referencias vistas y nombra desde los datos", () => {
    const d = sanitizeDiscovery(raw, seen)!;
    expect(d.evidence_refs).toEqual(["evidence:e1"]);
    expect(d.signal_refs).toEqual(["signal:s1"]);
    expect(d.question_refs).toEqual(["question:q1"]);
    expect(d.who_can_help.map((h) => [h.ref, h.name, h.purpose])).toEqual([["contact:c1", "Martín · Hotel", "inteligencia"], ["company:k1", "Hotel", "inteligencia"]]);
    expect(d.belief).toBe("La vacancia rota más de lo que muestra el inventario.");
  });
  it("sin evidencia vista el nivel es nula; solo con señales externas, a lo sumo baja", () => {
    expect(sanitizeDiscovery({ ...raw, evidence_refs: [], signal_refs: [] }, seen)!.evidence_level).toBe("nula");
    expect(sanitizeDiscovery({ ...raw, evidence_refs: ["evidence:inventada"] }, seen)!.evidence_level).toBe("baja");
    expect(sanitizeDiscovery({ ...raw, evidence_level: "media" }, seen)!.evidence_level).toBe("media");
  });
});
