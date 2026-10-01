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
  it("fuera de la ventana no se une", () => {
    const viejo = k("Chevron pide el RIGI por US$ 13.800 M para triplicar El Trapial", { happened_on: "2026-08-01" });
    expect(sameEvent({ headline: "Chevron presentó al RIGI US$13.800 M para El Trapial", happened_on: "2026-10-01" }, [viejo])).toBeNull();
  });
  it("cifras: años no cuentan; separadores de miles sí", () => {
    expect([...figures("US$ 13.800 M hacia 2035, 502 pozos")].sort()).toEqual(["13800", "502"]);
  });
});
