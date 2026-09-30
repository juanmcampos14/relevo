// Casos del CRM real reproducidos con datos sintéticos (sin teléfonos ni correos reales en el repo).
import { describe, expect, it } from "vitest";
import { mapCompany, mapContact, mapEvidenceStatus, mapSource, mapTask, parseDate, type RawRow } from "./map";
import { threeWay } from "./diff";
import { baseDomain, domainOf, findCandidates, normalizeName, phoneKey } from "./dedupe";

const row = (sheet: string, values: Record<string, string | null>, n = 5): RawRow => ({ sheet, row: n, values });

describe("empresas", () => {
  it("fila limpia: etapa, prioridad, estado y fecha dd/mm", () => {
    const m = mapCompany(row("EMPRESAS", {
      "ID anterior": "AN-0023", ID: "AN-0023", "Empresa / establecimiento": "Hotel Ejemplo", Sector: "Alojamiento",
      Subsector: "Hotel + viandas B2B", "Localidad / zona": "Añelo", Dirección: "RP7 y RP17", Prioridad: "Alta",
      "Etapa CRM": "Investigación", "Estado de evidencia": "Fuente pública pendiente revalidación", "Fuente ID": "SRC-003",
      Responsable: "Tano", "Próxima acción": "Identificar decisor", "Fecha próxima acción": "05/10/2026",
    }));
    expect(m.externalId).toBe("AN-0023");
    expect(m.values).toMatchObject({ priority: 1, stage: "investigacion", verification_status: "partially_verified", next_action_due: "2026-10-05", activity: "Hotel + viandas B2B" });
    expect(m.issues).toEqual([]);
  });

  it("ID calculado distinto del ID anterior bloquea la fila", () => {
    const m = mapCompany(row("EMPRESAS", { "ID anterior": "AN-0065", ID: "AN-0066", "Empresa / establecimiento": "Transporte X" }));
    expect(m.issues.map((i) => [i.code, i.severity])).toContainEqual(["id_inestable", "bloquea"]);
  });

  it("web en el campo teléfono: se propone moverla, no se corrige sola", () => {
    const m = mapCompany(row("EMPRESAS", { "ID anterior": "AN-0041", ID: "AN-0041", "Empresa / establecimiento": "Constructora X", "Teléfono público": "https://www.constructora.example/" }));
    const issue = m.issues.find((i) => i.code === "dato_en_campo_incorrecto");
    expect(issue?.proposal?.patch).toEqual({ website: "https://www.constructora.example/", public_phone: null });
    expect(m.values.public_phone).toBeNull();
    expect(m.values.website).toBeNull();
  });

  it("estado y fuente en texto libre quedan marcados", () => {
    const m = mapCompany(row("EMPRESAS", {
      "ID anterior": "AN-0054", ID: "AN-0054", "Empresa / establecimiento": "Modular X",
      "Estado de evidencia": "Ficha comercial; validar propietario y B2B", "Fuente ID": "AOG Patagonia 2026 / sitio oficial",
    }));
    expect(m.issues.map((i) => i.code).sort()).toEqual(["estado_texto_libre", "fuente_texto_libre"]);
    expect(m.values.verification_status).toBe("partially_verified");
    expect(m.values.notes).toContain("Ficha comercial");
  });

  it("el detalle del estado no se pierde: pasa a evidence_note", () => {
    const m = mapCompany(row("EMPRESAS", { "ID anterior": "AN-0054", ID: "AN-0054", "Empresa / establecimiento": "Modular X", "Estado de evidencia": "Verificado públicamente · expositor AOG 2026 + operación Neuquén" }));
    expect(m.values).toMatchObject({ verification_status: "publicly_verified", evidence_note: "expositor AOG 2026 + operación Neuquén" });
    expect(mapCompany(row("EMPRESAS", { "ID anterior": "AN-1", ID: "AN-1", "Empresa / establecimiento": "Y", "Estado de evidencia": "Pre-mapeado" })).values.evidence_note).toBeNull();
  });

  it("mapping de estados aprobado", () => {
    expect(mapEvidenceStatus("Pre-mapeado").status).toBe("unverified");
    expect(mapEvidenceStatus("No verificado").status).toBe("unverified");
    expect(mapEvidenceStatus(null).status).toBe("unverified");
    expect(mapEvidenceStatus("Verificado públicamente · expositor AOG 2026").status).toBe("publicly_verified");
  });
});

describe("contactos, actividades y fuentes", () => {
  it("un cargo que el Sheet marca 'persona por identificar' entra como canal institucional sin pedir revisión", () => {
    const m = mapContact(row("RED | CONTACTOS", { ID: "CT-005", Nombre: "Administración (cargo; persona por identificar)", "Empresa ID": "AN-0023", "Acceso / vínculo": "Buzón institucional", "Fecha respuesta": "Perfil encontrado" }));
    const inst = m.issues.find((i) => i.code === "canal_institucional");
    expect(inst?.severity).toBe("info");
    expect(m.values).toMatchObject({ contact_kind: "canal_institucional", full_name: "Administración" });
    expect(m.values.preferred_channel).toBe("email");
    expect(m.issues.some((i) => i.code === "dato_en_campo_incorrecto" && i.field === "Fecha respuesta")).toBe(true);
  });

  it("un buzón sin la marca del Sheet se propone como canal institucional (alguien decide)", () => {
    const m = mapContact(row("RED | CONTACTOS", { ID: "CT-007", Nombre: "Área compras", "Empresa ID": "AN-0023" }));
    const inst = m.issues.find((i) => i.code === "canal_institucional");
    expect(inst).toMatchObject({ severity: "revisar", proposal: { patch: { contact_kind: "canal_institucional", full_name: "Área compras" } } });
    expect(m.values.contact_kind).toBe("persona");
  });

  it("un equipo o un responsable por identificar tampoco son personas: entran como canal sin revisión", () => {
    for (const [nombre, limpio] of [["Equipo comercial", "Equipo comercial"], ["Responsable por identificar", "Responsable (por identificar)"]]) {
      const m = mapContact(row("RED | CONTACTOS", { ID: "CT-038", Nombre: nombre, "Empresa ID": "AN-0088" }));
      expect(m.values).toMatchObject({ contact_kind: "canal_institucional", full_name: limpio });
      expect(m.issues.find((i) => i.code === "canal_institucional")?.severity).toBe("info");
    }
  });

  it("responsable compartido y estado de actividad", () => {
    const m = mapTask(row("ACTIVIDADES", { ID: "ACT-020", "Empresa ID": "AN-0029", "Actividad / objetivo": "Presentación", Responsable: "Tano + Fran", Estado: "Pendiente", Vencimiento: "2026-10-20" }));
    expect(m.values).toMatchObject({ status: "todo", due_on: "2026-10-20" });
    expect(m.issues.map((i) => i.code)).toEqual(["responsable_compartido"]);
  });

  it("fuente de 'Mercado' es contexto, no evidencia sobre una empresa", () => {
    const m = mapSource(row("FUENTES", { ID: "SRC-004", "Entidad vinculada": "Mercado", "Título / evidencia": "Adjudicación bypass", "URL original": "https://gob.example/nota", Calidad: "Alta" }));
    expect(m.values.entity_ref).toBeNull();
    expect(m.values.quality).toBe("alta");
    expect(m.issues.map((i) => i.code)).toEqual(["fuente_sin_entidad"]);
  });

  it("fechas", () => {
    expect(parseDate("2026-09-27")).toBe("2026-09-27");
    expect(parseDate("1/10/2026")).toBe("2026-10-01");
    expect(parseDate("Perfil encontrado")).toBeNull();
  });
});

describe("diff en tres sentidos", () => {
  const F = ["next_action", "priority", "notes"];
  const base = { next_action: "Llamar", priority: 1, notes: "a" };

  it("primera vez: nuevo", () => {
    expect(threeWay(base, null, null, F)).toEqual({ kind: "nuevo" });
  });
  it("solo cambió el Sheet: se propone actualizar", () => {
    const r = threeWay({ ...base, next_action: "Visitar" }, base, base, F);
    expect(r).toMatchObject({ kind: "cambios", updates: [{ field: "next_action", to: "Visitar" }], conflicts: [], relevoEdited: false });
  });
  it("solo cambió RELEVO: no se pisa", () => {
    expect(threeWay(base, base, { ...base, notes: "editado en RELEVO" }, F)).toEqual({ kind: "sin_cambios", relevoEdited: true });
  });
  it("cambió el mismo campo en ambos lados: conflicto", () => {
    const r = threeWay({ ...base, next_action: "Visitar" }, base, { ...base, next_action: "Mandar mail" }, F);
    expect(r).toMatchObject({ kind: "cambios", updates: [], conflicts: [{ field: "next_action", sheet: "Visitar", relevo: "Mandar mail", base: "Llamar" }] });
  });
  it("vacío y null son lo mismo", () => {
    expect(threeWay({ ...base, notes: "" }, { ...base, notes: null }, { ...base, notes: null }, F).kind).toBe("sin_cambios");
  });
});

describe("posibles duplicados", () => {
  const existing = [
    { id: "1", name: "Mobilbox S.A.", website: "https://mobilbox.example", locality: "Neuquén" },
    { id: "2", name: "YPF", website: "https://www.ypf.example" },
    { id: "3", name: "Hotel del Centro", phone: "+54 9 299 555-1234" },
  ];
  it("normaliza nombres, dominios y teléfonos", () => {
    expect(normalizeName("Mobilbox S.A.")).toBe("mobilbox");
    expect(domainOf("www.ypf.example/proveedores")).toBe("ypf.example");
    expect(baseDomain("proveedores.ypf.com")).toBe("ypf.com");
    expect(baseDomain("tienda.empresa.com.ar")).toBe("empresa.com.ar");
    expect(phoneKey("0299 555-1234")).toBe(phoneKey("+54 9 299 555-1234"));
  });
  it("encuentra por nombre, dominio o teléfono", () => {
    expect(findCandidates({ id: "x", name: "MOBILBOX", locality: "Neuquén" }, existing)).toEqual([{ id: "1", name: "Mobilbox S.A.", reason: "mismo_nombre" }]);
    expect(findCandidates({ id: "x", name: "YPF S.A. Proveedores", website: "https://proveedores.ypf.example" }, existing).map((c) => c.id)).toEqual(["2"]);
    expect(findCandidates({ id: "x", name: "Otro nombre", phone: "0299 555-1234" }, existing)).toEqual([{ id: "3", name: "Hotel del Centro", reason: "mismo_telefono" }]);
    expect(findCandidates({ id: "x", name: "Lavandería Sur" }, existing)).toEqual([]);
  });
});

describe("responsables", () => {
  const members = [
    { user_id: "u1", display_name: "Estanislao Vilamajó", email: "tano@example.com" },
    { user_id: "u2", display_name: "Juan", email: "juan@example.com" },
  ];
  it("Tano por apodo; Fran todavía no es miembro", async () => {
    const { resolveOwners } = await import("./map");
    expect(resolveOwners("Tano + Fran", members)).toEqual({ ids: ["u1"], unknown: ["fran"] });
    expect(resolveOwners(null, members)).toEqual({ ids: [], unknown: [] });
  });
});

describe("identidad de personas: el nombre solo sugiere", async () => {
  const { findContactCandidates } = await import("./dedupe");
  const pool = [
    { id: "a", name: "Juan Pérez", email: "juan@pecom.example", companies: ["PECOM"] },
    { id: "b", name: "Juan Perez", companies: ["Otra SA"] },
  ];
  it("email es fuerte; nombre + empresa es sugerencia fuerte; nombre solo es sugerencia débil", () => {
    expect(findContactCandidates({ id: "", name: "J. Pérez", email: "JUAN@pecom.example" }, pool)).toEqual([{ id: "a", name: "Juan Pérez", reason: "mismo_email" }]);
    expect(findContactCandidates({ id: "", name: "Juan Pérez", companies: ["Pecom"] }, pool).map((c) => [c.id, c.reason])).toEqual([["a", "mismo_nombre_y_empresa"], ["b", "mismo_nombre"]]);
  });
});
