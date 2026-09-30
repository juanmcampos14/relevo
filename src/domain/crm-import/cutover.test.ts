import { describe, expect, it } from "vitest";
import { readCutover, reconciliationBatch } from "./cutover";

describe("corte del Sheet", () => {
  it("por defecto el Sheet sigue activo", () => {
    expect(readCutover({})).toMatchObject({ status: "activo", cutoff_on: null, history: [] });
  });
  it("la reconciliación final es un lote completo aplicado desde la fecha de corte", () => {
    const batches = [
      { id: "piloto", status: "aplicado", created_at: "2026-10-14T15:00:00Z", summary: { filtro: ["AN-0023"] } },
      { id: "viejo", status: "aplicado", created_at: "2026-10-10T15:00:00Z", summary: { filtro: null } },
      { id: "revision", status: "en_revision", created_at: "2026-10-15T15:00:00Z", summary: { filtro: null } },
      { id: "final", status: "aplicado", created_at: "2026-10-15T12:00:00Z", summary: { filtro: null } },
    ];
    expect(reconciliationBatch(batches, "2026-10-14")).toEqual({ id: "final" });
    expect(reconciliationBatch(batches, null)).toBeNull();
    expect(reconciliationBatch(batches.slice(0, 3), "2026-10-14")).toBeNull();
  });
});
