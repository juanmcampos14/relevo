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
    const label = (t: string) => missionDay(t, "2026-10-16", "2026-10-26")?.label;
    expect(label("2026-09-29")).toBe("Faltan 17 días");
    expect(label("2026-10-15")).toBe("Falta 1 día");
    expect(label("2026-10-16")).toBe("Día 1 de 11");
    expect(label("2026-10-26")).toBe("Día 11 de 11");
    expect(missionDay("2026-10-27", "2026-10-16", "2026-10-26")).toEqual({ phase: "despues", label: "Misión finalizada · toca sintetizar" });
    expect(missionDay("2026-10-18", null, null)).toBeNull();
  });
});
