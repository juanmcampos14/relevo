import { describe, expect, it } from "vitest";
import { deterministicGaps, gapsFromDimensions, isAssessmentStale, metrics, orderGaps, sanitizeDimensions, type EvidenceLink } from "./readiness";

const link = (id: string, over: Partial<EvidenceLink> = {}): EvidenceLink => ({
  id, stance: "supports", verification_status: "unverified", revalidate_after: null,
  company_id: null, stated_by_contact_id: null, capture_id: null, visit_id: null, source_id: null, ...over,
});

describe("métricas sin IA", () => {
  it("dos datos de la misma empresa son un solo caso; otra empresa suma un segundo caso", () => {
    const one = [link("e1", { company_id: "c1" }), link("e2", { company_id: "c1", capture_id: "k2" })];
    expect(metrics(one, "2026-10-17").independentCases).toBe(1);
    expect(metrics([...one, link("e3", { company_id: "c2" })], "2026-10-17").independentCases).toBe(2);
  });

  it("cuenta contraevidencia, verificada y desactualizada", () => {
    const m = metrics([
      link("e1", { verification_status: "field_verified", capture_id: "k1" }),
      link("e2", { stance: "contradicts", verification_status: "publicly_verified", source_id: "s1" }),
      link("e3", { revalidate_after: "2026-10-01", capture_id: "k3" }),
    ], "2026-10-17");
    expect(m).toEqual({ supports: 2, contradicts: 1, contextual: 0, independentCases: 2, verified: 2, stale: 1 });
  });
});

describe("faltantes explicables", () => {
  it("una sola declaración: falta triangulación; con contraevidencia: contradicción primero", () => {
    const m = metrics([link("e1", { capture_id: "k1" }), link("e2", { stance: "contradicts", capture_id: "k2" })], "2026-10-17");
    expect(orderGaps([...gapsFromDimensions([]), ...deterministicGaps(m)])).toEqual([
      "contradiccion_sin_resolver", "falta_triangulacion", "falta_recurrencia", "falta_comprador", "falta_economia", "falta_solucion_actual",
    ]);
  });

  it("sin evidencia a favor: evidencia insuficiente (no triangulación)", () => {
    expect(deterministicGaps(metrics([], "2026-10-17"))).toEqual(["evidencia_insuficiente"]);
  });
});

describe("control de lo que devuelve la IA", () => {
  const links = [link("e1", { capture_id: "k1" }), link("e2", { stance: "contradicts", capture_id: "k2" })];
  const dims = sanitizeDimensions([
    { key: "problema", status: "sabido", summary: "Una empresa declaró que manda camionetas a Neuquén.", evidence_ids: ["e1", "inventada"] },
    { key: "frecuencia", status: "sabido", summary: "Todas las semanas", evidence_ids: [] },
    { key: "impacto", status: "contradicho", summary: "…", evidence_ids: ["e1"] },
    { key: "comprador", status: "contradicho", summary: "…", evidence_ids: ["e2"] },
    { key: "inventada", status: "sabido", summary: "…", evidence_ids: ["e1"] },
  ], links);

  it("todas las dimensiones, una vez, en orden", () => {
    expect(dims).toHaveLength(12);
    expect(dims.map((d) => d.key)[0]).toBe("problema");
    expect(dims.find((d) => d.key === "piloto")).toMatchObject({ status: "falta" });
  });

  it("descarta evidencia inexistente y baja a 'creido' lo que no está respaldado", () => {
    expect(dims.find((d) => d.key === "problema")).toMatchObject({ status: "sabido", evidence_ids: ["e1"] });
    expect(dims.find((d) => d.key === "frecuencia")!.status).toBe("creido");
    expect(dims.find((d) => d.key === "impacto")!.status).toBe("creido");
    expect(dims.find((d) => d.key === "comprador")!.status).toBe("contradicho");
  });

  it("análisis desactualizado cuando cambia la evidencia", () => {
    expect(isAssessmentStale(["e1", "e2"], ["e2", "e1"])).toBe(false);
    expect(isAssessmentStale(["e1"], ["e1", "e3"])).toBe(true);
  });
});
