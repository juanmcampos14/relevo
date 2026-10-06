import { describe, expect, it } from "vitest";
import { budgetState, budgetWindow } from "./ai-budget";

describe("tope mensual de IA", () => {
  it("el primer mes cuenta desde que rige y con el tope prorrateado", () => {
    const w = budgetWindow(new Date("2026-10-10T15:00:00Z"), 20, "2026-10-07T03:00:00Z");
    expect(w.start.toISOString()).toBe("2026-10-07T03:00:00.000Z");
    expect(w.cap).toBeCloseTo((20 * 25) / 31, 5);
  });
  it("un mes completo: tope entero; el fondo corre solo si el gasto va al día", () => {
    const now = new Date("2026-11-16T03:00:00Z"); // mitad de noviembre
    const w = budgetWindow(now, 20, "2026-10-07T03:00:00Z");
    expect(w.cap).toBe(20);
    expect(budgetState(9, w, now).allowBackground).toBe(true);
    expect(budgetState(12, w, now).allowBackground).toBe(false);
    expect(budgetState(12, w, now).allowUser).toBe(true);
    expect(budgetState(20, w, now).allowUser).toBe(false);
  });
});
