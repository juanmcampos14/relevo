import { describe, expect, it } from "vitest";
import { assessmentChanged, enteredHorizon, isMaterialSignal, novelty, placeSignal, type KnownEvent } from "./material";

const cafe: KnownEvent = {
  id: "ev-cafe", headline: "Café Martínez llega a Añelo", summary: "La cadena de cafeterías anunció su desembarco en la ciudad.",
  happened_on: "2026-10-03", story_id: null, company_ids: [], asset_ids: [],
  text: "Café Martínez llega a Añelo La cadena de cafeterías anunció su desembarco en la ciudad.",
};
const base = { change: "nuevo" as const, relevance: "alta" as const };

describe("cambio material: señales", () => {
  it("una señal sola es material si cambia algo y no es ruido", () => {
    expect(isMaterialSignal({ change: "nuevo", relevance: "media" })).toBe(true);
    expect(isMaterialSignal({ change: "confirmado", relevance: "alta" })).toBe(false);
    expect(isMaterialSignal({ change: "nuevo", relevance: "baja" })).toBe(false);
  });

  it("TEST 3 — otro medio, mismo hecho: fuente adicional, no novedad", () => {
    const p = placeSignal({ ...base, headline: "Café Martínez desembarca en Añelo", summary: "La cadena de cafeterías llega a la ciudad petrolera.", happened_on: "2026-10-04" }, [cafe], { today: new Date("2026-10-04T12:00:00Z") });
    expect(p).toEqual({ kind: "misma", eventId: "ev-cafe", material: false, change: "confirmado" });
  });

  it("TEST 4 — la segunda fuente trae contrato, operador y fecha: actualiza el hecho y es material", () => {
    const p = placeSignal({ ...base, headline: "Café Martínez firmó contrato: abre en Añelo con el operador Grupo Sur en noviembre", happened_on: "2026-10-05" }, [cafe], { today: new Date("2026-10-05T12:00:00Z") });
    expect(p.kind).toBe("actualiza");
    expect(p.material).toBe(true);
    if (p.kind === "actualiza") expect(p.novel).toEqual(expect.arrayContaining(["contrato", "operador", "fecha"]));
  });

  it("un hecho que no conocíamos es una señal nueva", () => {
    const p = placeSignal({ ...base, headline: "Neuquén anuncia prueba piloto de bitrenes hacia Añelo" }, [cafe]);
    expect(p).toEqual({ kind: "nueva", material: true, change: "nuevo" });
  });

  it("la pista del modelo (mismo hecho) manda aunque las palabras no coincidan", () => {
    const p = placeSignal({ ...base, headline: "La marca porteña de cafés abre su local en noviembre" }, [cafe], { sameAs: "ev-cafe" });
    expect(p.kind).toBe("actualiza"); // noviembre es un dato nuevo
    const q = placeSignal({ ...base, headline: "La marca porteña de cafeterías confirma su llegada" }, [cafe], { sameAs: "ev-cafe" });
    expect(q.kind).toBe("misma");
  });

  it("una contradicción del mismo hecho siempre es material", () => {
    const p = placeSignal({ change: "contradicho", relevance: "media", headline: "Café Martínez desmiente que llegue a Añelo" }, [cafe], { sameAs: "ev-cafe" });
    expect(p.material).toBe(true);
  });

  it("no confunde lugares con el mismo hecho", () => {
    const p = placeSignal({ ...base, headline: "Vaca Muerta: Tecpetrol suma equipos en Fortín de Piedra" }, [{ ...cafe, text: `${cafe.text} en Vaca Muerta` }]);
    expect(p.kind).toBe("nueva");
  });

  it("novedad: cifras y empresas nuevas cuentan, la misma idea con otras palabras no", () => {
    const ev = { text: "YPF adjudicó el galpón por US$ 1.200.000", company_ids: ["c1"], asset_ids: [] };
    expect(novelty({ headline: "YPF adjudica galpón en Añelo por US$ 1.200.000", company_ids: ["c1"] }, ev)).toEqual([]);
    expect(novelty({ headline: "YPF adjudicó el galpón por US$ 1.450.000", company_ids: ["c1", "c2"] }, ev)).toEqual(["cifra 1450000", "empresa c2"]);
  });
});

describe("cambio material: hipótesis y agenda", () => {
  const a = { dimensions: [{ key: "demanda", status: "creido" }, { key: "comprador", status: "falta" }], gaps: ["comprador"], supports: 2, contradicts: 0 };
  it("re-evaluar sin cambiar lo que creemos no es material", () => {
    expect(assessmentChanged(a, { ...a, supports: 3 })).toBe(false);
    expect(assessmentChanged(a, { ...a, dimensions: [{ key: "demanda", status: "sabido" }, { key: "comprador", status: "falta" }] })).toBe(true);
    expect(assessmentChanged(a, { ...a, contradicts: 1 })).toBe(true);
    expect(assessmentChanged(null, a)).toBe(true);
  });

  it("una fecha entra al horizonte (hoy/mañana) una sola vez", () => {
    const since = new Date("2026-10-05T12:00:00Z");
    expect(enteredHorizon("2026-10-07", since, new Date("2026-10-06T12:00:00Z"))).toBe(true);
    expect(enteredHorizon("2026-10-07", since, new Date("2026-10-05T20:00:00Z"))).toBe(false);
    expect(enteredHorizon("2026-10-06", since, new Date("2026-10-06T12:00:00Z"))).toBe(false); // ya estaba en el horizonte
  });
});
