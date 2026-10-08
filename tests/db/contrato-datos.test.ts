// Contrato de datos (docs/13): prioridad de preparación de ACTIVIDADES, fechas escritas por automatizaciones
// y la agenda de campo (RUTA | VISITAS y AOG) con la clasificación aprobada, por la sincronización real del
// Sheet. Libro armado en el test; base real con el cliente admin (como el cron). Sin IA (no hay Radar).
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { syncSheet } from "@/server/sheet/sync";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const SHEET = `contrato-${Date.now()}`;
let ws: string, vm: string;

async function book(o: { rutaHallazgo?: string; duplicateAct?: boolean; ordenNeuquen?: string } = {}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const e = wb.addWorksheet("EMPRESAS");
  e.addRow(["ID anterior", "ID", "Empresa / establecimiento", "Sector", "Localidad / zona", "Prioridad"]);
  e.addRow(["AN-9201", "AN-9201", "Operadora Uno", "Operadora", "Neuquén", "Alta"]);
  e.addRow(["AN-9202", "AN-9202", "Housing Dos", "Alojamiento", "Añelo", "Alta"]);
  wb.addWorksheet("RED | CONTACTOS").addRow(["ID", "Nombre", "Empresa ID", "Acceso / vínculo"]);
  const a = wb.addWorksheet("ACTIVIDADES");
  a.addRow(["ID", "Empresa ID", "Contacto ID", "Tipo", "Actividad / objetivo", "Responsable", "Vencimiento", "Estado", "Resultado", "Bloque operativo · RELEVO", "Prioridad preparación"]);
  a.addRow(["ACT-901", "AN-9202", "", "Investigación", "Pedir ocupación y tarifa por cama", "Tano", "Mon Oct 05 2026 21:00:00 GMT-0300 (Argentina Standard Time)", "Pendiente", "", "PREVIAJE · confirmar si se ejecutó", "P1 · foco inicial"]);
  a.addRow(["ACT-902", "AN-9201", "", "Correo", "Escribir a compras", "Tano", "19/10/2026", "Pendiente", "", "AOG 20–21 · preparación", "P2 · mantener en cartera"]);
  if (o.duplicateAct) {
    a.addRow(["ACT-903", "AN-9201", "", "Llamada", "Llamar a la operadora", "Tano", "20/10/2026", "Pendiente", "", "", "P2 · mantener en cartera"]);
    a.addRow(["ACT-903", "AN-9202", "", "Llamada", "Otra actividad con el mismo ID", "Tano", "21/10/2026", "Pendiente", "", "", "P2 · mantener en cartera"]);
  }
  wb.addWorksheet("FUENTES").addRow(["ID", "Entidad vinculada", "URL original"]);
  const r = wb.addWorksheet("RUTA | VISITAS");
  r.addRow(["CAMPO · NEUQUÉN + AÑELO"]);
  r.addRow(["Día", "Orden", "Franja", "Zona", "Vertical", "Punto de visita", "Bloque", "Pregunta clave", "Estado visita", "Hallazgo / conclusión", "Acceso recomendado", "ID CRM"]);
  r.addRow(["20 OCT", "2", "13:00–17:15", "DUAM", "Compradores", "Operadoras + buyer targets", "AOG / BUYER DISCOVERY", "", "En agenda", "", "Conferencias", "AN-9201 / AN-9999"]);
  r.addRow(["23 OCT", "1", "08:00–09:00", "Añelo", "Red local", "CEISA / Cámara", "CAMPO DÍA 2 / ORIGINACIÓN", "", "Por coordinar", "", "Reunión", "MAP-024"]);
  r.addRow(["23 OCT", "4", "12:15–13:30", "Añelo", "Housing", "Operador de housing", "CAMPO DÍA 2 / HOUSING", "¿Qué no pueden absorber?", "Por coordinar", o.rutaHallazgo ?? "", "Reunión", "AN-9202"]);
  r.addRow(["19 OCT", o.ordenNeuquen ?? "4", "10:30–12:00", "Alto Neuquén", "Shopping / franquicias", "Alto Comahue Shopping", "NEUQUÉN / FRANCHISE SCAN", "", "En agenda", "", "Mystery shopping", ""]);
  r.addRow(["26 OCT", "2", "Media mañana", "Neuquén", "Traslado", "Traslado al aeropuerto", "REGRESO / LUNES", "", "Por reservar", "", "Traslado", ""]);
  const g = wb.addWorksheet("AOG | MAPA FÍSICO");
  g.addRow(["Prioridad", "Actor", "Stand oficial", "Zona física", "CRM", "Rol misión", "Día sugerido", "Objetivo", "Contacto / acceso", "Estado"]);
  g.addRow(["A", "Operadora Uno", "1B-10", "Hall 1", "AN-9201", "BUYER", "20 OCT", "Procurement", "", "Buscar reunión / stand"]);
  g.addRow(["A", "CAPESPE", "", "", "", "ORIGINATOR", "20 OCT", "Originación", "", ""]);
  g.addRow(["A", "Chevron", "", "", "", "BUYER / OPERATOR", "20 OCT", "Supply chain", "", ""]);
  g.addRow([]);
  g.addRow(["Prioridad", "Día / hora", "Por qué importa a misión", "Quién / empresa"]);
  g.addRow(["A", "21 OCT · 13:00–14:00", "Durabilidad de demanda", "Comisión Planeamiento"]);
  const m = wb.addWorksheet("MAPA | IMPORTAR");
  m.addRow(["ID CRM / mapa", "Lugar", "Vertical"]);
  m.addRow(["MAP-024", "CEISA Cámara Empresarial", "Institucional"]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Contrato de datos");
  vm = (await pool.query(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'Añelo', 'mision', 'activa') returning id`, [ws])).rows[0].id;
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("contrato de datos con el CRM", () => {
  it("lee la prioridad de preparación y las fechas de ACTIVIDADES, y arma la agenda de campo sin inventar vínculos", async () => {
    const s1 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: await book(), trigger: "prueba" });
    expect(s1.status).toBe("procesado");

    const { data: tasks } = await db.from("tasks").select("title, due_on, prep_priority, prep_block").eq("workspace_id", ws).order("title");
    expect(tasks).toEqual([
      { title: "Escribir a compras", due_on: "2026-10-19", prep_priority: "P2 · mantener en cartera", prep_block: "AOG 20–21 · preparación" },
      { title: "Pedir ocupación y tarifa por cama", due_on: "2026-10-06", prep_priority: "P1 · foco inicial", prep_block: "PREVIAJE · confirmar si se ejecutó" },
    ]);

    const stops = async () => (await pool.query(`select s.external_ref, s.kind, s.stop_class, s.crm_status, s.outcome, s.label, c.trade_name, p.planned_on::text as day
      from visit_stops s join visit_plans p on p.id = s.plan_id left join campaign_targets t on t.id = s.target_id left join companies c on c.id = t.company_id
      where s.workspace_id = $1 order by s.external_ref`, [ws])).rows;
    const first = await stops();
    expect(first.map((s) => [s.external_ref, s.stop_class, s.kind, s.trade_name, s.day])).toEqual([
      ["AOG-SESION:21 OCT · 13:00–14:00|COMISIÓN PLANEAMIENTO", "sesion", "evento", null, "2026-10-21"],
      ["AOG:CAPESPE", "organizacion", "organizacion", null, "2026-10-20"],
      ["AOG:CHEVRON", "empresa_sin_id", "libre", null, "2026-10-20"],
      ["AOG:OPERADORA UNO", "empresa", "empresa", "Operadora Uno", "2026-10-20"],
      ["RUTA:19 OCT#4", "recorrido", "zona", null, "2026-10-19"],
      // La misma empresa dos veces el mismo día (ruta y AOG); el AN-9999 que no existe no se vincula.
      ["RUTA:20 OCT#2:AN-9201", "empresa", "empresa", "Operadora Uno", "2026-10-20"],
      ["RUTA:23 OCT#1", "organizacion", "organizacion", null, "2026-10-23"],
      ["RUTA:23 OCT#4:AN-9202", "empresa", "empresa", "Housing Dos", "2026-10-23"],
      ["RUTA:26 OCT#2", "logistica", "libre", null, "2026-10-26"],
    ]);
    expect(first.find((s) => s.external_ref === "RUTA:23 OCT#1")!.crm_status).toBe("Por coordinar");
    expect(s1.result.campo).toMatchObject({ creadas: 9, sinFecha: 0 });

    // Sin cambios en el Sheet: no se toca nada.
    const s2 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: await book(), trigger: "prueba" });
    expect(s2.status).toBe("sin_cambios");

    // Se registra un resultado en una visita: se actualiza esa parada (no se duplica) y el resto no se reprocesa.
    const s3 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: await book({ rutaHallazgo: "PRUEBA: 80% de ocupación declarada" }), trigger: "prueba" });
    expect(s3.changed["RUTA | VISITAS"]).toEqual({ nuevas: [], modificadas: ["RUTA:23 OCT#4"] });
    const after = await stops();
    expect(after).toHaveLength(9);
    expect(after.find((s) => s.external_ref === "RUTA:23 OCT#4:AN-9202")!.outcome).toBe("PRUEBA: 80% de ocupación declarada");

    // Revertir el resultado en el Sheet lo saca de RELEVO (sin perder la parada).
    await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: await book(), trigger: "prueba" });
    expect((await stops()).find((s) => s.external_ref === "RUTA:23 OCT#4:AN-9202")!.outcome).toBeNull();

    // El CRM cambia el Orden de una visita (pasa a un código, "NQN-3"): la parada vieja sale de la agenda y
    // entra la nueva; no quedan duplicadas.
    const s4 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: await book({ ordenNeuquen: "NQN-3" }), trigger: "prueba" });
    expect(s4.result.campo?.retiradas).toEqual(["RUTA:19 OCT#4"]);
    const refs4 = (await stops()).map((s) => s.external_ref);
    expect(refs4).toHaveLength(9);
    expect(refs4).toContain("RUTA:19 OCT#NQN-3");
    expect(refs4).not.toContain("RUTA:19 OCT#4");

    // Un ID repetido en el CRM no frena la sincronización: esas filas no se procesan y se informan.
    const s5 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: await book({ duplicateAct: true, ordenNeuquen: "NQN-3" }), trigger: "prueba" });
    expect(s5.status).not.toBe("error");
    expect(s5.result.idsDuplicados).toEqual({ ACTIVIDADES: ["ACT-903"] });
    expect((await db.from("tasks").select("id").eq("workspace_id", ws)).data).toHaveLength(2);

    // Una actividad puede quedar cancelada, con su historial.
    const { error } = await db.from("tasks").update({ status: "cancelada" }).eq("workspace_id", ws).eq("title", "Escribir a compras");
    expect(error).toBeNull();
  });
});
