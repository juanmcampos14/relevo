import { describe, expect, it } from "vitest";
import { summarize, triageBatch, type TriageRow } from "./triage";

let n = 0;
const row = (over: Partial<TriageRow> & { values?: Record<string, unknown> }): TriageRow => ({
  id: `r${++n}`, entity_type: "company", external_id: `AN-${n}`, action: "crear", decision: "pendiente",
  raw: { label: String(over.values?.trade_name ?? `Empresa ${n}`) }, mapped: { values: over.values ?? { trade_name: `Empresa ${n}` } },
  issues: [], conflicts: {}, ...over,
});

describe("triage del lote: excepciones, no normalidad", () => {
  const nueva = row({ values: { trade_name: "Hotel Uno", locality: "Añelo" }, issues: [{ code: "fuente_texto_libre", severity: "info", message: "…" }] });
  const rutina = row({ entity_type: "contact", action: "actualizar", values: { full_name: "Ana" }, conflicts: { updates: [{ field: "role_title", from: "Compras", to: "Jefa de compras" }] } });
  const material = row({ entity_type: "contact", action: "actualizar", values: { full_name: "Luis" }, conflicts: { updates: [{ field: "email", from: "a@x.com", to: "b@x.com" }] } });
  const conflicto = row({ action: "conflicto", conflicts: { conflicts: [{ field: "stage", base: "a", sheet: "b", relevo: "c" }] } });
  const dudoso = row({ issues: [{ code: "dato_en_campo_incorrecto", severity: "revisar", message: "Etapa desconocida" }] });
  const dupRelevo = row({ issues: [{ code: "posible_duplicado", severity: "revisar", message: "Parece la misma empresa que X", proposal: { label: "Vincular", patch: {} } }] });
  const dupA = row({ values: { trade_name: "Vaca Muerta Facility Group", locality: "Añelo" } });
  const dupB = row({ values: { trade_name: "VACA MUERTA FACILITY GROUP", locality: "Añelo" } });
  const bloqueada = row({ entity_type: "contact", action: "rechazar", decision: "rechazada", issues: [{ code: "referencia_rota", severity: "bloquea", message: "La empresa AN-9 no existe" }] });
  const igual = row({ action: "sin_cambios", decision: "aprobada" });
  const rows = [nueva, rutina, material, conflicto, dudoso, dupRelevo, dupA, dupB, bloqueada, igual];
  const t = triageBatch(rows);

  it("nuevo sin coincidencias y cambio de rutina del Sheet: entran con el lote", () => {
    expect(t.get(nueva.id)).toEqual({ lane: "importable", reasons: [] });
    expect(t.get(rutina.id)!.lane).toBe("importable");
  });

  it("conflicto, dato dudoso (aun sin propuesta), duplicado y cambio material: revisión humana", () => {
    for (const r of [material, conflicto, dudoso, dupRelevo, dupA, dupB]) expect(t.get(r.id)!.lane).toBe("revisar");
    expect(t.get(material.id)!.reasons[0].text).toContain("email");
    expect(t.get(dupA.id)!.reasons[0].key).toBe("Posible duplicado dentro del archivo");
  });

  it("bloqueado no entra; sin cambios no se triagea", () => {
    expect(t.get(bloqueada.id)!.lane).toBe("bloqueado");
    expect(t.has(igual.id)).toBe(false);
  });

  it("resumen: qué entra, por qué, qué mirar y qué no entra", () => {
    const s = summarize(rows, t);
    expect(s.importable).toMatchObject({ total: 2, byKind: { "empresa nueva": 1, "persona con cambios del Sheet": 1 } });
    expect(s.importable.notes[0]).toMatchObject({ code: "fuente_texto_libre", count: 1 });
    expect(s.revisar.total).toBe(6);
    expect(s.revisar.byReason.find((x) => x.label === "Posible duplicado dentro del archivo")!.count).toBe(2);
    expect(s.bloqueado).toMatchObject({ total: 1, byReason: [{ label: "Referencia a un registro que no existe", count: 1 }] });
  });
});
