import { describe, expect, it } from "vitest";
import { pulseDue } from "./pulse";

describe("pulso de la misión", () => {
  const now = new Date("2026-10-03T13:30:00Z");
  it("la vigilancia del mediodía (13:30 UTC) puede re-priorizar después de la síntesis de la mañana (09:00), no antes de 4 horas", () => {
    expect(pulseDue("2026-10-03T09:00:00Z", now)).toBe(true);
    expect(pulseDue("2026-10-03T10:00:00Z", now)).toBe(false);
    expect(pulseDue(null, now)).toBe(true);
  });
});
