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

describe("E1: qué cambió con la evidencia nueva", () => {
  const base = [link("a1", { company_id: "c1" })];
  it("otra empresa suma un segundo caso; la misma empresa refuerza sin triangular; en contra, contradice", async () => {
    const { evidenceEffect } = await import("./readiness");
    const findings = [
      { id: "f1", statement: "Faltan talleres", links: [...base, link("n1", { company_id: "c2" })] },
      { id: "f2", statement: "Hay capacidad ociosa", links: [link("b1", { company_id: "c1" }), link("n2", { company_id: "c1" })] },
      { id: "f3", statement: "Los talleres alcanzan", links: [link("b2", { company_id: "c3" }), link("n3", { stance: "contradicts", company_id: "c2" })] },
      { id: "f4", statement: "Sin relación", links: [link("x", { company_id: "c9" })] },
    ];
    const eff = evidenceEffect(findings, new Set(["n1", "n2", "n3"]), "2026-10-17");
    expect(eff.map((e) => [e.findingId, e.kinds])).toEqual([["f3", ["contradice"]], ["f1", ["segundo_caso"]], ["f2", ["mismo_caso"]]]);
    expect(eff[1].text).toContain("deja de ser un caso aislado");
  });
});

describe("E3: memoria de evolución", () => {
  it("día 1 señal, día 3 segundo caso, día 4 contraevidencia, día 6 se resuelve economía", async () => {
    const { findingTimeline, trendSince } = await import("./readiness");
    const ev = findingTimeline({
      createdAt: "2026-10-16T10:00:00Z",
      origin: "captura de campo",
      links: [
        { ...link("e1", { company_id: "c1" }), linkedAt: "2026-10-16T10:00:01Z", statement: "Mandan 8 camionetas a Neuquén" },
        { ...link("e2", { company_id: "c1" }), linkedAt: "2026-10-17T10:00:00Z", statement: "Pierden un día por viaje" },
        { ...link("e3", { company_id: "c2" }), linkedAt: "2026-10-18T10:00:00Z", statement: "Otra flota hace lo mismo" },
        { ...link("e4", { stance: "contradicts", company_id: "c3" }), linkedAt: "2026-10-19T10:00:00Z", statement: "Un taller dice que tiene capacidad" },
      ],
      assessments: [
        { at: "2026-10-18T11:00:00Z", gaps: ["falta_economia", "falta_comprador"] },
        { at: "2026-10-21T11:00:00Z", gaps: ["contradiccion_sin_resolver", "falta_comprador"] },
      ],
      validations: [{ title: "Llamar a compras de la flota 2", createdAt: "2026-10-19T12:00:00Z", completedAt: null }],
    });
    expect(ev.map((e) => e.kind)).toEqual(["apertura", "caso", "mismo_caso", "caso", "contradiccion", "validacion_agendada", "faltante_resuelto", "faltante_nuevo"]);
    expect(ev[3].text).toContain("Segundo caso independiente");
    expect(trendSince(ev, "2026-10-19T00:00:00Z")).toBe("en_disputa");
    expect(trendSince(ev, "2026-10-18T00:00:00Z")).toBe("en_disputa");
    expect(trendSince(ev.slice(0, 4), "2026-10-18T00:00:00Z")).toBe("se_fortalecio");
  });
});

describe("E4: valor de información", () => {
  const dims = (falta: string[]) => ["problema", "comprador", "decisor", "impacto", "presupuesto", "frecuencia"].map((key) => ({ key, status: falta.includes(key) ? "falta" : "sabido", summary: "", evidence_ids: [] })) as never;
  it("contradicción > comprador (con 2+ casos) > segundo caso; explica por qué y qué falta aprender", async () => {
    const { valueOfInformation } = await import("./readiness");
    const ps = valueOfInformation([
      { findingId: "uno", statement: "Un solo caso", gaps: ["falta_triangulacion"], dimensions: dims(["comprador"]), supports: 1, contradicts: 0, independentCases: 1, proposed: [{ title: "Hablar con otra flota", why: "", gap: "falta_triangulacion" }], scheduled: [] },
      { findingId: "dos", statement: "Flotas mandan a Neuquén", gaps: ["falta_comprador"], dimensions: dims(["comprador", "decisor", "presupuesto"]), supports: 3, contradicts: 0, independentCases: 2, proposed: [], scheduled: [{ title: "Hablar con responsable de flota de X", due: null }] },
      { findingId: "tres", statement: "Hay capacidad", gaps: ["contradiccion_sin_resolver"], dimensions: dims([]), supports: 2, contradicts: 1, independentCases: 2, proposed: [], scheduled: [] },
      { findingId: "cero", statement: "Sin evidencia", gaps: ["evidencia_insuficiente"], dimensions: dims([]), supports: 0, contradicts: 0, independentCases: 0, proposed: [], scheduled: [] },
    ]);
    expect(ps.map((p) => [p.findingId, p.stage])).toEqual([["tres", "resolver"], ["dos", "comprador"], ["uno", "triangular"]]);
    expect(ps[1]).toMatchObject({ action: "Hablar con responsable de flota de X", scheduled: true, toLearn: ["Comprador / pagador", "Decisor", "Presupuesto"] });
    expect(ps[1].why).toContain("2 casos independientes del problema pero todavía no sabemos quién paga");
    expect(ps[2].action).toBe("Hablar con otra flota");
  });
});
