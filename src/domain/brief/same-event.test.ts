import { describe, expect, it } from "vitest";
import { figures, sameEvent } from "./same-event";

const k = (headline: string, extra: Partial<{ happened_on: string; company_ids: string[] }> = {}) => ({ id: headline.slice(0, 8), headline, happened_on: extra.happened_on ?? "2026-09-30", story_id: "st", company_ids: extra.company_ids ?? [] });

describe("mismo hecho, otra fuente", () => {
  it("Chevron: misma cifra y mismas palabras en otro medio = mismo hecho", () => {
    const ayer = k("Chevron pide el RIGI por US$ 13.800 M para triplicar El Trapial");
    expect(sameEvent({ headline: "Chevron presentó al RIGI US$13.800 M para triplicar El Trapial hacia 2035", happened_on: "2026-10-01" }, [ayer])).toBe(ayer);
  });
  it("misma empresa pero hecho distinto (adjudica contratista) = no es el mismo", () => {
    const ayer = k("Chevron pide el RIGI por US$ 13.800 M para triplicar El Trapial", { company_ids: ["c1"] });
    expect(sameEvent({ headline: "Chevron adjudica a Contreras el montaje de la planta de El Trapial", happened_on: "2026-10-05", company_ids: ["c1"] }, [ayer])).toBeNull();
  });
  it("lo que RELEVO ya sabe pesa más que la ventana: una coincidencia fuerte de hace 60 días se une", () => {
    const viejo = k("Chevron pide el RIGI por US$ 13.800 M para triplicar El Trapial", { happened_on: "2026-08-01" });
    expect(sameEvent({ headline: "Chevron presentó al RIGI US$13.800 M para El Trapial", happened_on: "2026-10-01" }, [viejo])).toBe(viejo);
  });
  it("fuera de la ventana, una coincidencia débil (solo palabras) no se une", () => {
    const viejo = k("Corte de ruta en acceso a Añelo por reclamo gremial de camioneros", { happened_on: "2026-08-01" });
    expect(sameEvent({ headline: "Reclamo gremial de camioneros corta la ruta de acceso a Añelo", happened_on: "2026-10-01" }, [viejo])).toBeNull();
    expect(sameEvent({ headline: "Reclamo gremial de camioneros corta la ruta de acceso a Añelo", happened_on: "2026-08-03" }, [viejo])).toBe(viejo);
  });
  it("una historia sin fecha (memoria de RELEVO) se compara a cualquier antigüedad", () => {
    const historia = { id: "h", headline: "Hotel Prueba en venta por USD 980.000", summary: "Complejo de 12 habitaciones en Añelo", happened_on: null, story_id: "h" };
    expect(sameEvent({ headline: "Sigue publicado en venta el Hotel Prueba: USD 980.000", happened_on: "2026-12-01" }, [historia])).toBe(historia);
  });
  it("cifras: años no cuentan; separadores de miles sí", () => {
    expect([...figures("US$ 13.800 M hacia 2035, 502 pozos")].sort()).toEqual(["13800", "502"]);
  });
});
