import { describe, expect, it } from "vitest";
import { classifyPlace, sameDistinctiveName } from "./geo-match";

const anelo = { lat: -38.35, lng: -68.79 };
const neuquen = { lat: -38.95, lng: -68.06 };
const place = (name: string, at = anelo, types = ["establishment"]) => ({ name, ...at, types });

describe("coincidencias de mapa sin inventar precisión (casos reales del primer lote)", () => {
  it("las palabras genéricas no alcanzan", () => {
    expect(sameDistinctiveName("VN Viandas Neuquén Añelo", "F&P Viandas")).toBe(false);
    expect(sameDistinctiveName("Vaca Muerta Facility Group", "Vaca Muerta Info Comercial")).toBe(false);
    expect(sameDistinctiveName("Indulav Industrial Laundry", "LAVASUR Lavadero Industrial")).toBe(false);
    expect(sameDistinctiveName("Mountain suites", "NEU AÑELO Suites")).toBe(false);
    expect(sameDistinctiveName("Complejo habitacional", "Complejo habitacional Beron")).toBe(false);
    expect(sameDistinctiveName("Complejo en obra", "Complejo Los Alamos")).toBe(false);
  });
  it("el nombre distintivo sí", () => {
    expect(sameDistinctiveName("SJG Ferretería Industrial", "SJG Ferreteria industrial")).toBe(true);
    expect(sameDistinctiveName("FERRELEC / Genelec", "Ferrelec Buloneria y Ferretería Industrial")).toBe(true);
    expect(sameDistinctiveName("Añelo Shale Hotel", "Shale Hotel Añelo")).toBe(true);
    expect(sameDistinctiveName("Grupo Beraldi", "TRANSPORTES JOSE BERALDI .S.A")).toBe(true);
  });
  it("lejos de donde decimos que está, no es", () => {
    expect(classifyPlace({ name: "Hotel Leonardo Da Vinci", locality: "Añelo" }, place("Hotel Leonardo Da Vinci", { lat: -38.93, lng: -69.23 }))).toBeNull();
    expect(classifyPlace({ name: "Storage Compat", locality: null }, place("STORAGE COMPAT", { lat: -34.6, lng: -58.4 }))).toBeNull();
    expect(classifyPlace({ name: "SAMPE Medicina para Empresas", locality: "Neuquén" }, place("SAMPE Medicina para Empresas", neuquen))).toBe("aproximada");
  });
  it("un barrio con ese nombre es la zona, no el lugar", () => {
    expect(classifyPlace({ name: "Complejo La Forestada", locality: "Añelo" }, place("La Forestada", anelo, ["neighborhood", "political"]))).toBe("inferida");
    expect(classifyPlace({ name: "Departamento La Meseta", locality: "Añelo", kind: "asset" }, place("De la Meseta"))).toBe("inferida");
    expect(classifyPlace({ name: "Lavadero Titan", locality: "Añelo" }, place("Lavadero titan"))).toBe("aproximada");
  });
});
