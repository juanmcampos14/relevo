import { describe, expect, it } from "vitest";
import { historyStart } from "./history";

describe("ventana del historial", () => {
  it("el comienzo queda fijo varios turnos (prefijo cacheable) y nunca manda menos de 6 filas", () => {
    expect([0, 2, 4, 6, 8, 10].map(historyStart)).toEqual([0, 0, 0, 0, 0, 0]);
    expect([12, 14, 16].map(historyStart)).toEqual([6, 6, 6]);
    expect(historyStart(18)).toBe(12);
    for (const n of [6, 9, 12, 17, 30]) expect(n - historyStart(n)).toBeGreaterThanOrEqual(6);
  });
});
