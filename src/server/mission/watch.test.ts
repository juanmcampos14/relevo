import { describe, expect, it } from "vitest";
import { addCriterion, watchQueries } from "./watch";

describe("vigilancia de la misión", () => {
  it("'avisame cuando…' queda como pedido de aviso (sin duplicar) y suma búsquedas", () => {
    let w = addCriterion(null, { text: "Locales de 40 a 60 m² del lado del río, hasta $1,5 M por mes", queries: ["alquiler local Vicente López"] });
    w = addCriterion(w, { text: "locales de 40 a 60 m² del lado del río, hasta $1,5 M por mes" });
    expect(w.criteria).toHaveLength(1);
    expect(w.queries).toEqual(["alquiler local Vicente López"]);
  });
  it("busca lo configurado y a sus actores más importantes", () => {
    const q = watchQueries({ id: "m", workspace_id: "w", slug: "s", settings: null, name: "Vaca Muerta / Añelo — Discovery 2026", objective: null, watch: { queries: ["Añelo"] } }, [{ name: "PECOM", priority: 1 }, { name: "Otra", priority: 2 }]);
    expect(q).toEqual(["Añelo", '"PECOM"']);
  });
});
