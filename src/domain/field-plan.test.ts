import { describe, expect, it } from "vitest";
import { aogStops, fieldDay, routeStops } from "./field-plan";
import { parseDate } from "./crm-import/map";

const row = (n: number, v: Record<string, string>) => ({ row: n, values: v });
const companies = new Set(["AN-0029", "AN-0101", "AN-0035", "AN-0088"]);
const maps = new Map([["MAP-024", "Institucional"], ["MAP-029", "Territorio / industria"]]);

describe("agenda de campo desde el CRM (clasificación aprobada el 08/10)", () => {
  it("una fila con varias empresas válidas da una parada por empresa; un ID inexistente no inventa vínculo", () => {
    const s = routeStops([row(1, { "Día": "20 OCT", Orden: "2", Franja: "13:00–17:15", "Punto de visita": "PAE · Vista · YPF + buyer targets", Bloque: "AOG / BUYER DISCOVERY", "ID CRM": "AN-0029 / AN-0101 / AN-9999" })], { year: 2026, companies, maps });
    expect(s.map((x) => [x.cls, x.companyRef, x.day])).toEqual([["empresa", "AN-0029", "2026-10-20"], ["empresa", "AN-0101", "2026-10-20"]]);
  });

  it("MAP institucional es organización, otro MAP es ubicación, AOG sin ID es sesión, logística, a definir y recorrido", () => {
    const s = routeStops(
      [
        row(1, { "Día": "23 OCT", Orden: "1", "Punto de visita": "CEISA / Cámara · una conversación transversal", "ID CRM": "MAP-024", Bloque: "CAMPO DÍA 2 / ORIGINACIÓN" }),
        row(2, { "Día": "22 OCT", Orden: "5", "Punto de visita": "Parque Industrial · barrido corto", "ID CRM": "MAP-029", Bloque: "CAMPO DÍA 1 / INDUSTRIA" }),
        row(3, { "Día": "20 OCT", Orden: "4", "Punto de visita": "FECENE + ADENEU", Bloque: "AOG / ORIGINATORS", Vertical: "Originación PyME" }),
        row(4, { "Día": "26 OCT", Orden: "2", "Punto de visita": "Traslado al aeropuerto NQN", Vertical: "Traslado", Bloque: "REGRESO / LUNES" }),
        row(5, { "Día": "21 OCT", Orden: "4", "Punto de visita": "Cierre AOG → Añelo 22", Vertical: "Síntesis / campo", Bloque: "AOG / → CAMPO", "Acceso recomendado": "Agenda" }),
        row(6, { "Día": "23 OCT", Orden: "2", "Punto de visita": "Caso #1 · problema más fuerte del jueves", Zona: "Según señal #1", "Estado visita": "A definir en campo" }),
        row(7, { "Día": "19 OCT", Orden: "4", "Punto de visita": "Alto Comahue Shopping + entorno", Vertical: "Shopping / franquicias", Bloque: "NEUQUÉN / FRANCHISE SCAN", "Acceso recomendado": "Mystery shopping" }),
      ],
      { year: 2026, companies, maps },
    );
    expect(s.map((x) => x.cls)).toEqual(["organizacion", "ubicacion", "sesion", "logistica", "logistica", "a_definir", "recorrido"]);
    expect(s.map((x) => x.kind)).toEqual(["organizacion", "lugar", "evento", "libre", "libre", "libre", "zona"]);
    expect(s.every((x) => x.companyRef === null)).toBe(true);
  });

  it("AOG: actor con ID = empresa; cámara = organización; operador sin ID = candidato, no empresa; sesión = evento", () => {
    const s = aogStops(
      [
        row(1, { Prioridad: "A", Actor: "YPF", "Rol misión": "BUYER", CRM: "AN-0029", "Día sugerido": "20 OCT", Estado: "Buscar reunión / stand" }),
        row(2, { Prioridad: "A", Actor: "CAPESPE", "Rol misión": "ORIGINATOR", "Día sugerido": "20 OCT" }),
        row(3, { Prioridad: "A", Actor: "Chevron", "Rol misión": "BUYER / OPERATOR", "Día sugerido": "20 OCT" }),
      ],
      [row(25, { Prioridad: "A", "Día / hora": "21 OCT · 13:00–14:00", "Por qué importa a misión": "Durabilidad de demanda", "Quién / empresa": "Comisión Planeamiento y Análisis Económico" })],
      { year: 2026, companies, eventDay: "2026-10-20" },
    );
    expect(s.map((x) => [x.label, x.cls, x.companyRef, x.day])).toEqual([
      ["YPF", "empresa", "AN-0029", "2026-10-20"],
      ["CAPESPE", "organizacion", null, "2026-10-20"],
      ["Chevron", "empresa_sin_id", null, "2026-10-20"],
      ["Comisión Planeamiento y Análisis Económico", "sesion", null, "2026-10-21"],
    ]);
    expect(s[3].timeSlot).toBe("13:00–14:00");
    expect(s[0].crmStatus).toBe("Buscar reunión / stand");
  });

  it("fechas del CRM: '19 OCT', dd/mm/aaaa y el texto de una automatización (medianoche UTC)", () => {
    expect(fieldDay("19 OCT", 2026)).toBe("2026-10-19");
    expect(parseDate("19/10/2026")).toBe("2026-10-19");
    expect(parseDate("Mon Oct 05 2026 21:00:00 GMT-0300 (Argentina Standard Time)")).toBe("2026-10-06");
  });
});
