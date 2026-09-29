import { describe, expect, it } from "vitest";
import { addDays, missionDay, pickPriorities, type PriorityItem } from "./today";

const item = (kind: PriorityItem["kind"], due?: string): PriorityItem => ({ kind, title: kind, href: "#", due });

describe("HOY: mis 3 prioridades", () => {
  const items = [item("capturas"), item("voto"), item("accion_vencida", "2026-10-15"), item("visita_hoy"), item("accion_vencida", "2026-10-10")];

  it("operativo: vencido (más viejo primero), visitas de hoy, votos", () => {
    expect(pickPriorities(items, "operativa").map((i) => `${i.kind}${i.due ?? ""}`)).toEqual([
      "accion_vencida2026-10-10",
      "accion_vencida2026-10-15",
      "visita_hoy",
    ]);
  });

  it("ejecutivo: el voto pendiente va primero", () => {
    expect(pickPriorities(items, "ejecutiva")[0].kind).toBe("voto");
  });

  it("con menos de 3 elementos devuelve los que hay", () => {
    expect(pickPriorities([item("capturas")], "operativa")).toHaveLength(1);
  });
});

describe("fechas de la misión", () => {
  it("suma días sin corrimientos de zona horaria", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("antes, durante y después del viaje", () => {
    expect(missionDay("2026-10-10", "2026-10-16", "2026-10-26")).toBe("Empieza en 6 días");
    expect(missionDay("2026-10-15", "2026-10-16", "2026-10-26")).toBe("Empieza mañana");
    expect(missionDay("2026-10-18", "2026-10-16", "2026-10-26")).toBe("Día 3 de 11");
    expect(missionDay("2026-10-27", "2026-10-16", "2026-10-26")).toBe("Finalizada");
    expect(missionDay("2026-10-18", null, null)).toBeNull();
  });
});
