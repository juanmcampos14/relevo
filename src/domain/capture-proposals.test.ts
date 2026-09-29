import { describe, expect, it } from "vitest";
import { buildProposals, verifiedQuote } from "./capture-proposals";

const body = "Hablé con el encargado de una empresa. Tienen 35 camionetas y mandan 8 por semana a Neuquén porque no consiguen resolver determinados mantenimientos en Añelo.";

const extraction = {
  summary: "Empresa con flota de 35 camionetas deriva mantenimiento a Neuquén.",
  company: { name: "Transportes X", existing_id: "no-existe", locality: "Añelo", activity: "Flota", quote: null },
  people: [
    { key: "p1", name: null, role: "Encargado", institutional: false, existing_id: null, quote: "el encargado" },
    { key: "p2", name: null, role: null, institutional: false, existing_id: null, quote: null },
  ],
  evidence: [
    { key: "e1", statement: "Tienen 35 camionetas", quote: "Tienen 35 camionetas", evidence_type: "capacidad", origin: "declaracion" as const, stated_by: "p1", about_company: true, related_findings: [{ finding_id: "f1", stance: "supports" as const }, { finding_id: "inventado", stance: "contradicts" as const }] },
    { key: "e2", statement: "Mandan 8 camionetas por semana a Neuquén por mantenimiento", quote: "mandan  8 por semana a NEUQUÉN", evidence_type: "dato", origin: "declaracion" as const, stated_by: "p9", about_company: true, related_findings: [] },
    { key: "e3", statement: "Dicen que es caro", quote: "es carísimo", evidence_type: "declaracion", origin: "declaracion" as const, stated_by: null, about_company: true, related_findings: [] },
  ],
  finding_candidates: [{ statement: "Posible falta de talleres de flota en Añelo", kind: "necesidad", rationale: "…", supports: ["e1", "e2", "e9"], contradicts: [] }],
  next_actions: [{ title: "Hablar con Compras sobre gasto", why: "…", contact: "p1", due: "en dos semanas" }],
};

const ctx = {
  body,
  companies: [{ id: "c1", name: "Transportes X S.A.", locality: "Añelo" }],
  contacts: [],
  findings: [{ id: "f1", statement: "Faltan servicios de flota en Añelo" }],
};

describe("propuestas desde una captura", () => {
  const drafts = buildProposals(extraction, ctx);
  const byKind = (k: string) => drafts.filter((d) => d.kind === k);

  it("orden: empresa, personas, evidencia, finding, próxima acción", () => {
    expect(drafts.map((d) => d.kind)).toEqual(["company", "person", "evidence", "evidence", "evidence", "finding", "next_action"]);
    expect(drafts.map((d) => d.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("un id existente inventado se ignora, pero se detecta el duplicado real", () => {
    expect(byKind("company")[0].matches).toEqual([{ type: "company", id: "c1", name: "Transportes X S.A.", reason: "mismo nombre" }]);
  });

  it("una persona sin nombre ni rol se descarta; sin nombre = canal institucional", () => {
    expect(byKind("person")).toHaveLength(1);
    expect(byKind("person")[0].payload).toMatchObject({ key: "p1", name: null, role: "Encargado", institutional: true, company_key: "c" });
  });

  it("citas: solo textuales (tolera espacios y mayúsculas)", () => {
    const [e1, e2, e3] = byKind("evidence");
    expect(e1.quote).toBe("Tienen 35 camionetas");
    expect(e2.quote).toBe("mandan  8 por semana a NEUQUÉN");
    expect(e3.quote).toBeNull();
    expect(verifiedQuote("xx", body)).toBeNull();
  });

  it("referencias inválidas se limpian: persona, finding existente, evidencia", () => {
    const [e1, e2] = byKind("evidence");
    expect(e1.payload.related_findings).toEqual([{ finding_id: "f1", stance: "supports" }]);
    expect(e2.payload.stated_by).toBeNull();
    expect(byKind("finding")[0].payload.supports).toEqual(["e1", "e2"]);
  });

  it("fecha de la próxima acción solo si es AAAA-MM-DD", () => {
    expect(byKind("next_action")[0].payload).toMatchObject({ contact: "p1", due: null });
  });
});
