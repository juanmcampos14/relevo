import { describe, expect, it } from "vitest";
import { pulseDue } from "./pulse";

describe("pulso de la misión", () => {
  const now = new Date("2026-10-03T15:30:00Z");
  it("con la síntesis de la mañana (09:00) corre a la tarde, no después de cada vigilancia", () => {
    expect(pulseDue("2026-10-03T09:00:00Z", now)).toBe(true);
    expect(pulseDue("2026-10-03T11:30:00Z", now)).toBe(false);
    expect(pulseDue(null, now)).toBe(true);
  });
});
