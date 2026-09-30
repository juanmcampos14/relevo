// Migración de investigación desde el CRM: IDs del Sheet conservados, hipótesis pendientes de revisión,
// preguntas vinculadas, empresas por ID del CRM y reejecución sin duplicados. Libro sintético.
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { migrateResearch } from "@/server/crm-import/research-apply";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, company: string;

async function workbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const inv = wb.addWorksheet("INVESTIGACIÓN | ENTREVISTAS");
  inv.addRow(["Industria", "Dimensión", "Pregunta de entrevista", "Qué evidencia pedir", "Problema / hipótesis", "Empresa entrevistada", "Respuesta / dato", "Fuente / fecha", "Próxima acción", "Responsable"]);
  inv.addRow(["Todas", "Demanda", "¿Qué tres servicios les generan más problemas?", "Casos recientes", "Necesidad real"]);
  inv.addRow(["Todas", "Regla RELEVO · Recurrencia", "¿La señal se repite?", "2+ casos", "Evitar anécdotas", "", "", "", "Registrar frecuencia", "RELEVO OS"]);
  inv.addRow(["Viandas / restaurantes / catering", "H-VA-01 · Discovery AOG/Voice", "Contame el último caso concreto…", "Último pedido fallido", "HIPÓTESIS · La fricción está en horario y entrega.", "", "", "Diseño RELEVO · 30/09/2026", "Perfiles: Compras. Empresas: AN-9001 / AN-9002.", "Tano"]);
  inv.addRow(["Gomerías + neumáticos", "H-VA-04 · Discovery AOG/Voice", "Contame el último incidente…", "Incidente", "HIPÓTESIS · Auxilio limita flotas.", "", "", "Diseño RELEVO", "Empresas: AN-9003.", "Tano"]);
  inv.addRow(["Voice of Añelo", "VO-Q08 · H-VA-01/04", "¿Algún traslado te hizo perder tiempo?", "No / sí", "Diseño de investigación", "", "", "Voice V1", "Captura sin persona CRM", "Tano"]);
  const hal = wb.addWorksheet("HALLAZGOS");
  hal.addRow(["ID", "Fecha", "Hallazgo / señal", "Tipo", "Vertical", "Empresa / lugar", "Evidencia", "Frecuencia", "Impacto", "Próxima acción", "Responsable", "Estado", "Estado evidencia", "Contraevidencia"]);
  hal.addRow(["HAL-901", "2026-09-30", "Complejo en venta con precio inconsistente", "Negocio en venta", "Activos / inmobiliario", "Complejo X · Añelo", "1 · Indicio público", "Por confirmar", "No cuantificado", "Pedir precio real", "Tano", "Investigar", "partially_verified", "La portada muestra otro precio"]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Investigación");
  company = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Viandas Prueba') returning id`, [ws])).rows[0].id;
  await pool.query(`insert into external_refs (workspace_id, source_system, external_id, entity_type, entity_id, sheet, row_number, last_values) values ($1, 'google_sheets', 'AN-9001', 'company', $2, 'EMPRESAS', 5, '{}')`, [ws, company]);
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("migración de investigación", () => {
  it("en seco no escribe y anticipa lo que haría", async () => {
    const r = await migrateResearch(db, ws, await workbook(), { dryRun: true });
    expect(r.hypotheses.created).toEqual(["H-VA-01", "H-VA-04", "HAL-901"]);
    expect(r.questions).toMatchObject({ created: 5, byKind: { entrevista: 3, regla: 1, voice: 1 } });
    expect(r.links.pendingCompanies).toEqual(["AN-9002", "AN-9003"]);
    const { count } = await db.from("findings").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count).toBe(0);
  });

  it("migra conservando IDs, pendientes de revisión, con verticales por código y vínculos", async () => {
    const r = await migrateResearch(db, ws, await workbook(), { dryRun: false });
    expect(r.verticals.created).toHaveLength(17);
    const { data: f } = await db.from("findings").select("id, dedup_key, statement, review_status, maturity, verticals(code)").eq("workspace_id", ws).order("dedup_key");
    expect(f!.map((x) => [x.dedup_key, x.review_status, x.maturity, x.verticals?.code])).toEqual([
      ["crm:H-VA-01", "pendiente_revision", "hipotesis", "V01"],
      ["crm:H-VA-04", "pendiente_revision", "hipotesis", "V04"],
      ["crm:HAL-901", "pendiente_revision", "hipotesis", "V17"],
    ]);
    expect(f![0].statement).toBe("La fricción está en horario y entrega.");
    const { data: fc } = await db.from("finding_companies").select("company_id").eq("finding_id", f![0].id);
    expect(fc).toEqual([{ company_id: company }]);
    const { data: vo } = await db.from("research_questions").select("id, kind, question_findings(finding_id)").eq("workspace_id", ws).eq("code", "VO-Q08").single();
    expect(vo!.question_findings.map((x) => x.finding_id).sort()).toEqual([f![0].id, f![1].id].sort());
  });

  it("reejecutar no duplica y vincula empresas importadas después", async () => {
    const c2 = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Otra Vianda') returning id`, [ws])).rows[0].id;
    await pool.query(`insert into external_refs (workspace_id, source_system, external_id, entity_type, entity_id, sheet, row_number, last_values) values ($1, 'google_sheets', 'AN-9002', 'company', $2, 'EMPRESAS', 6, '{}')`, [ws, c2]);
    const r = await migrateResearch(db, ws, await workbook(), { dryRun: false });
    expect(r.hypotheses).toMatchObject({ created: [], existing: ["H-VA-01", "H-VA-04", "HAL-901"] });
    expect(r.questions).toMatchObject({ created: 0, existing: 5 });
    expect(r.verticals.created).toEqual([]);
    expect(r.links.pendingCompanies).toEqual(["AN-9003"]);
    const { count } = await db.from("finding_companies").select("company_id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count).toBe(2);
  });
});
