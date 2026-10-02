import { describe, expect, it } from "vitest";
import { mergeDeclared } from "./context";

describe("contexto declarado de la misión", () => {
  it("lo que el equipo define se suma sin repetirse (y no es evidencia)", () => {
    const a = mergeDeclared([], ["Locales de 40 a 60 m²", "Tope de alquiler $2 M por mes"], { by: "Tano" });
    const b = mergeDeclared(a, ["locales de 40 a 60 m²", "No necesita salida de humos"], { by: "Tano" });
    expect(b.map((d) => d.text)).toEqual(["Locales de 40 a 60 m²", "Tope de alquiler $2 M por mes", "No necesita salida de humos"]);
  });
});
