import { describe, expect, it } from "vitest";
import type { Card } from "./candidate";
import { bestMatch, candidateImpact, entityKey, entityMatch, sameListing } from "./reconcile";

describe("identidad semántica", () => {
  it("'Lavandería X', 'Lavandería X Añelo' y 'Lavandería X SRL' son la misma", () => {
    expect(entityKey("Lavandería X SRL")).toBe(entityKey("Lavandería X Añelo"));
    expect(entityMatch("Lavandería X", "Lavandería X SRL")).toBe("misma");
    expect(entityMatch("Lavandería X Añelo", "LAVANDERIA X S.R.L.")).toBe("misma");
    expect(entityMatch("Lavadero Sur SRL", "Lavadero Sur")).toBe("misma");
  });
  it("comparten una palabra distintiva: se pregunta, nunca se une solo; otra cosa es distinta", () => {
    expect(entityMatch("Lavandería Titan", "Lavandería del Valle")).toBe("posible"); // "lavanderia"
    expect(entityMatch("Pluspetrol", "Pampa Energía")).toBe("distinta");
    expect(bestMatch("Lavadero Sur SRL", [{ id: "1", names: ["Lavandería del Valle"] }, { id: "2", names: ["Lavadero Sur"] }])).toEqual({ item: { id: "2", names: ["Lavadero Sur"] }, kind: "misma" });
  });
});

describe("publicaciones", () => {
  it("misma ficha o misma superficie y operación en la misma zona = mismo activo (un precio más, no un activo nuevo)", () => {
    expect(sameListing({ title: "a", url: "https://www.zonaprop.com.ar/propiedades/clasificado/x-60297615.html?utm=1" }, { title: "b", url: "https://www.zonaprop.com.ar/propiedades/clasificado/x-60297615.html" })).toBe(true);
    expect(sameListing({ title: "Galpón 450", surface_m2: 450, operation: "alquiler", locality: "Parque Industrial · Añelo" }, { title: "Galpón · Parque Industrial", surface_m2: 455, operation: "alquiler", locality: "Parque Industrial Añelo" })).toBe(true);
    expect(sameListing({ title: "Galpón 450", surface_m2: 450, operation: "alquiler" }, { title: "Galpón 300", surface_m2: 300, operation: "alquiler" })).toBe(false);
    // Misma superficie y operación pero otra cosa (caso real del Radar del 06/10).
    expect(sameListing({ title: "Base operativa 6.000 m² · PIN 3", surface_m2: 500, operation: "venta", locality: "Parque Industrial N°3 · Añelo" }, { title: "Complejo departamentos + local · Ruta 7", surface_m2: 500, operation: "venta", locality: "Ruta Provincial 7 · Añelo" })).toBe(false);
    // Los índices de un portal (misma URL de listado) no identifican un activo.
    expect(sameListing({ title: "Edificio 28", url: "https://inmuebles.mercadolibre.com.ar/venta/neuquen/anelo/" }, { title: "Cabañas", url: "https://inmuebles.mercadolibre.com.ar/venta/neuquen/anelo/" })).toBe(false);
  });
});

describe("caso lavandería: qué cambia con un dato nuevo", () => {
  const before: Card = {
    capacidad: { status: "sabido", evidence_ids: ["e1"], against_ids: [], values: [
      { variable: "capacidad_nominal", value: "1000", unit: "kg/día", basis: "declarado", evidence_ids: ["e1"] },
      { variable: "utilizacion", value: "700", unit: "kg/día", basis: "declarado", evidence_ids: ["e1"] },
      { variable: "demanda_rechazada", value: "200", unit: "kg/día", basis: "declarado", evidence_ids: ["e2"] },
    ] },
    demanda: { status: "sabido", summary: "Un hotel necesita proveedor.", evidence_ids: ["e3"], against_ids: [], values: [] },
  };
  const after: Card = { ...before, capacidad: { ...before.capacidad!, against_ids: ["e4"], values: [...before.capacidad!.values, { variable: "capacidad_futura", value: "500", unit: "kg/día", basis: "declarado", evidence_ids: ["e4"], about: "Lavadero Sur" }] } };

  it("sabía ~200 kg/día rechazados → aprende +500 de un competidor → la brecha queda cuestionada, sin descartar nada", () => {
    const i = candidateImpact(before, after, [{ role: "consumidor" }], "kg/día", "Lavadero Sur suma 500 kg/día en 6 meses");
    expect(i.changed).toBe(true);
    expect(i.before).toMatch(/200 kg\/día/);
    expect(i.effect).toBe("La existencia de una brecha real queda cuestionada.");
    expect(i.weakened[0]).toMatch(/demanda insatisfecha/);
    expect(i.stillUnknown).toEqual(expect.arrayContaining(["cuánta de la capacidad anunciada está realmente disponible y cuándo", "cómo gana plata y sus contratos", "precio y costo por unidad", "quién decide"]));
    expect(i.nextQuestion).toMatch(/capacidad nueva/);
  });

  it("un dato que no toca lo que creíamos no cambia nada: suma evidencia", () => {
    const i = candidateImpact(before, { ...before, demanda: { ...before.demanda!, evidence_ids: ["e3", "e5"] } }, [], "kg/día", "Otro hotel confirma");
    expect(i.changed).toBe(false);
    expect(i.effect).toMatch(/suma evidencia/);
  });
});
