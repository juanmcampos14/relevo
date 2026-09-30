import { describe, expect, it } from "vitest";
import { MIN_WORDS, NEAR_DUPLICATE, contentSimilarity, normalizeContent } from "./capture-dedupe";

const a = normalizeContent("[Audio 1, 0:25, transcripción automática]\nHablé con el encargado de una contratista. Trabajan unas 35 personas en la zona. Cuando no tienen vianda contratada reintegran hasta 18.000 pesos por comida.");
describe("conversación como evento único", () => {
  it("la misma conversación transcripta dos veces (con diferencias menores) es casi idéntica", () => {
    const b = normalizeContent("Hablé con el encargado de una contratista, trabajan unas 35 personas en la zona y cuando no tienen vianda contratada reintegran hasta 18 000 pesos por comida.");
    expect(contentSimilarity(a, b)).toBeGreaterThan(NEAR_DUPLICATE);
  });
  it("otra conversación sobre el mismo tema no es un duplicado", () => {
    const c = normalizeContent("Otro chofer de una petrolera me dijo que su empresa le da vianda todos los días y que no tiene problema para comer en la ruta.");
    expect(contentSimilarity(a, c)).toBeLessThan(0.2);
    expect(a.split(" ").length).toBeGreaterThan(MIN_WORDS);
  });
});
