import { describe, expect, it } from "vitest";
import { compareToReferences, mainQuantity, parseQuantities, pricePerM2 } from "./quantities";

describe("cifras con unidad", () => {
  it("dólares, pesos, m², personas y porcentaje con notación argentina", () => {
    expect(parseQuantities("La inmobiliaria pide USD 380.000 y son 2.400 m²")).toEqual([{ value: 380000, unit: "moneda", currency: "USD" }, { value: 2400, unit: "m2" }]);
    expect(mainQuantity("reintegran hasta 18.000 pesos por comida")).toEqual({ value: 18000, unit: "moneda", currency: "ARS" });
    expect(mainQuantity("pagan $ 18 mil por día")).toEqual({ value: 18000, unit: "moneda", currency: "ARS" });
    expect(mainQuantity("trabajan unas 35 personas en la zona")).toEqual({ value: 35, unit: "personas" });
    expect(mainQuantity("piden 1,2 millones de dólares")).toEqual({ value: 1200000, unit: "moneda", currency: "USD" });
    expect(mainQuantity("está 18% por encima")).toEqual({ value: 18, unit: "porcentaje" });
    expect(mainQuantity("no hay cifras acá")).toBeNull();
  });
  it("USD/m² y comparación con referencias", () => {
    expect(pricePerM2(380000, 2400)).toBe(158.33);
    expect(compareToReferences(158.33, [120, 134])).toEqual({ median: 127, diffPct: 25, min: 120, max: 134 });
  });
});
