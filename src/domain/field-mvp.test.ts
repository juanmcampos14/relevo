import { describe, expect, it } from "vitest";
import { candidateState, capacityGap, mergeSection, sanitizeCard, type Card } from "./candidate";
import { changedFields, respectLocks, withLocks } from "./locks";
import { promotionWarning } from "./promotion";
import { stopIsValid, stopPending, stopState, stopTitle } from "./stops";

describe("paradas generalizadas", () => {
  it("cada tipo exige lo suyo: empresa su objetivo, lugar/evento/zona/libre un nombre", () => {
    expect(stopIsValid({ kind: "empresa", target_id: "t1" })).toBe(true);
    expect(stopIsValid({ kind: "empresa", label: "Olivia" })).toBe(false);
    expect(stopIsValid({ kind: "lugar", label: "Cruce RP7 / RP17" })).toBe(true);
    expect(stopIsValid({ kind: "evento", label: "  " })).toBe(false);
    expect(stopIsValid({ kind: "persona", contact_id: "c1" })).toBe(true);
    expect(stopIsValid({ kind: "libre", label: "Broker por identificar" })).toBe(true);
  });
  it("los estados guardados se leen como los cinco del campo", () => {
    expect(stopState("confirmada")).toBe("planificada");
    expect(stopState("no_realizada")).toBe("salteada");
    expect(stopPending("en_curso")).toBe(true);
    expect(stopPending("cancelada")).toBe(false);
    expect(stopTitle({ kind: "zona", label: "Parque Industrial" })).toBe("Parque Industrial");
    expect(stopTitle({ kind: "empresa", label: null }, "Olivia Catering")).toBe("Olivia Catering");
  });
});

describe("candidato: el caso de la lavandería", () => {
  // Dueño: 700 kg/día de 1.000; rechaza ~200 kg/día en picos; cobra X/kg; limita equipamiento y capital de
  // trabajo; aceptaría un socio. Un hotel confirma que necesita proveedor. Un competidor suma 500 kg/día en 6 meses.
  const card: Card = {
    demanda: { status: "sabido", summary: "Un hotel confirma que necesita proveedor; el lavadero rechaza demanda en picos.", evidence_ids: ["ev-hotel", "ev-rechazo"], against_ids: [], values: [] },
    capacidad: {
      status: "sabido", evidence_ids: ["ev-dueno"], against_ids: ["ev-competidor"], values: [
        { variable: "capacidad_nominal", value: "1000", unit: "kg/día", basis: "declarado", evidence_ids: ["ev-dueno"] },
        { variable: "utilizacion", value: "700", unit: "kg/día", basis: "declarado", evidence_ids: ["ev-dueno"] },
        { variable: "demanda_rechazada", value: "200", unit: "kg/día", basis: "declarado", evidence_ids: ["ev-rechazo"] },
        { variable: "capacidad_futura", value: "500", unit: "kg/día", basis: "declarado", evidence_ids: ["ev-competidor"], about: "competidor" },
      ],
    },
    limitante: { status: "sabido", summary: "Equipamiento y capital de trabajo.", evidence_ids: ["ev-dueno"], against_ids: [], values: [] },
    economics: { status: "creido", evidence_ids: ["ev-dueno"], against_ids: [], values: [{ variable: "precio_unidad", value: "X", unit: "ARS/kg", basis: "declarado", evidence_ids: ["ev-dueno"] }] },
  };

  it("entiende la brecha y que la capacidad futura del competidor podría cerrarla", () => {
    const g = capacityGap(card, "kg/día");
    expect(g.gapNow).toBe(true);
    expect(g.gapAfterFuture).toBe(false);
    expect(g.explanation).toMatch(/podría cubrirla/);
  });

  it("dice qué sabemos, qué falta, qué importa y qué preguntar (sin mostrar la ficha entera)", () => {
    const s = candidateState(card, [{ role: "consumidor" }, { role: "pagador" }], "kg");
    expect(s.known.map((k) => k.section)).toEqual(["demanda", "limitante", "capacidad", "economics"]);
    expect(s.missing).toEqual(["negocio", "palanca", "riesgos", "proxima_validacion"]);
    expect(s.contradicted).toEqual(["capacidad"]); // el competidor es contraevidencia de la brecha
    expect(s.missingParties).toEqual(["decisor"]);
    expect(s.focus).toBe("negocio");
    expect(s.nextQuestion).toMatch(/gana plata/);
  });

  it("sin evidencia no hay 'declarado' ni 'sabido'", () => {
    const c = sanitizeCard({ riesgos: { status: "sabido", summary: "Depende de un cliente", evidence_ids: [], against_ids: [], values: [{ variable: "concentracion", value: "55%", basis: "declarado", evidence_ids: [] }] } });
    expect(c.riesgos!.status).toBe("creido");
    expect(c.riesgos!.values[0].basis).toBe("estimado");
  });

  it("las secciones se completan de a poco sin perder lo anterior", () => {
    const next = mergeSection(card, "capacidad", { status: "sabido", evidence_ids: ["ev-2"], against_ids: [], values: [{ variable: "utilizacion", value: "750", unit: "kg/día", basis: "observado", evidence_ids: ["ev-2"] }] });
    const vals = next.capacidad!.values;
    expect(vals.find((v) => v.variable === "utilizacion")!.value).toBe("750");
    expect(vals.find((v) => v.variable === "capacidad_futura")).toBeDefined();
    expect(next.capacidad!.evidence_ids).toEqual(["ev-dueno", "ev-2"]);
  });

  it("sin datos de rechazo ni utilización, la brecha es desconocida (no se inventa)", () => {
    expect(capacityGap({}).gapNow).toBeNull();
  });
});

describe("precedencia humana", () => {
  it("lo bloqueado no se pisa: si llega distinto queda como discrepancia", () => {
    const r = respectLocks({ title: "Espacio Añelo · 1.040 m²", locality: null }, { title: "Espacio Añelo declara 1.040 m², 100% construido", locality: "Añelo" }, ["title"]);
    expect(r.apply).toEqual({ locality: "Añelo" });
    expect(r.discrepancies).toEqual([{ field: "title", current: "Espacio Añelo · 1.040 m²", incoming: "Espacio Añelo declara 1.040 m², 100% construido" }]);
    expect(respectLocks({ title: "A" }, { title: "A" }, ["title"]).discrepancies).toEqual([]);
  });
  it("una edición humana bloquea solo lo que cambió", () => {
    expect(changedFields({ trade_name: "X", city: "Añelo" }, { trade_name: "X", city: "Neuquén" })).toEqual(["city"]);
    expect(withLocks(["title"], ["city", "title"])).toEqual(["city", "title"]);
  });
});

describe("guardrail de promoción", () => {
  it("avisa al promover sin evidencia (caso H-VA-02) y no molesta con evidencia suficiente", () => {
    expect(promotionWarning("finding", { evidence: 0, supports: 0, independentCases: 0, gaps: ["evidencia_insuficiente", "falta_comprador"] })).toMatch(/no tiene evidencia vinculada/);
    expect(promotionWarning("finding", { evidence: 4, supports: 3, independentCases: 2, gaps: ["falta_economia"] })).toBeNull();
    expect(promotionWarning("hipotesis", { evidence: 0, supports: 0, independentCases: 0, gaps: [] })).toBeNull();
  });
});
