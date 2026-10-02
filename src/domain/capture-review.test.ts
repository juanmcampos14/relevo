import { describe, expect, it } from "vitest";

describe("coincidencia clara con lo que ya está en RELEVO", () => {
  const base = { id: "p", status: "propuesta", payload: {} as Record<string, unknown> };
  it("mismo nombre (sin acentos) y un solo candidato: se vincula solo", async () => {
    const { clearMatch } = await import("./capture-review");
    expect(clearMatch({ ...base, kind: "person", payload: { name: "Nicolás Raviola" }, matches: [{ type: "contact", id: "c1", name: "Nicolas Raviola", reason: "sugerida por la IA" }] })).toBe("c1");
    expect(clearMatch({ ...base, kind: "company", payload: { name: "PECOM" }, matches: [{ type: "company", id: "e1", name: "PECOM", reason: "sugerida por la IA" }] })).toBe("e1");
    expect(clearMatch({ ...base, kind: "company", payload: { name: "Pecom Servicios" }, matches: [{ type: "company", id: "e1", name: "PECOM", reason: "mismo dominio" }] })).toBe("e1");
  });
  it("dos posibles, nombre distinto o solo el nombre de una persona sin empresa: se pregunta", async () => {
    const { clearMatch } = await import("./capture-review");
    expect(clearMatch({ ...base, kind: "company", payload: { name: "PECOM" }, matches: [{ type: "company", id: "e1", name: "PECOM", reason: "mismo nombre" }, { type: "company", id: "e2", name: "Pecom SA", reason: "nombre parecido" }] })).toBeNull();
    expect(clearMatch({ ...base, kind: "company", payload: { name: "Pecom Energía" }, matches: [{ type: "company", id: "e1", name: "PECOM", reason: "nombre parecido" }] })).toBeNull();
    expect(clearMatch({ ...base, kind: "person", payload: { name: "Juan Pérez" }, matches: [{ type: "contact", id: "c1", name: "Juan Pérez", reason: "solo coincide el nombre: confirmá con la empresa o el cargo" }] })).toBeNull();
  });
});
