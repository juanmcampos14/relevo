// RADAR del Sheet → Radar de RELEVO: activos con historial de precios (observación ≠ conclusión),
// señales por ID, guiones AOG como preguntas, URLs vistas y reejecución sin duplicar. Libro sintético.
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { migrateRadar } from "@/server/radar/import";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, hal: string;
const H = ["ID", "Fecha", "Tema", "Hallazgo", "Implicación hipotética RELEVO", "Enlace", "Estado validación", "Acción / responsable", "Tipo de señal", "Activo / entidad", "Categoría del activo", "Ubicación", "Precio actual USD", "Precio anterior USD", "Variación", "Capacidad / superficie", "Ocupación declarada", "Propietario", "Broker / contacto", "Operador / inquilino", "Motivo de venta", "Economics disponibles", "Primera detección", "Última comprobación", "Cambio material", "Capa de evidencia"];

async function book(price9: number): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("RADAR DE MERCADO");
  s.addRow(H);
  s.addRow(["RAD-901", "2026-09-29", "Infraestructura", "Adjudicado bypass de Añelo", "Explorar servicios al tránsito", "https://ejemplo.test/bypass", "Fuente pública", "Investigar", "Mercado"]);
  const r = s.addRow(["RAD-ACT-901", "2026-09-30", "Activos · alojamiento", "Hecho publicado: complejo Prueba con 9 departamentos, 415 m² cubiertos.", "No tratar como oportunidad", null, "Publicación verificada · precio inconsistente", "Pedir precio real", "Activo", "Complejo Prueba · 9 departamentos", "Alojamiento / housing", "Añelo", price9, 820000, -0.07, "415 m² cubiertos · 1.080 m² terreno", "Desconocida", "No informado", "Broker Prueba", "", "", "USD 84.444 por unidad", "2026-09-30", "2026-10-01", "Precio inconsistente", "Mixto"]);
  r.getCell(6).value = { formula: 'HYPERLINK("https://portal.test/aviso-9","Publicación ↗")', result: "Publicación ↗" };
  s.addRow(["RAD-ACT-902", "2026-09-30", "Activos · alojamiento", "Hecho publicado: departamento de 38 m² y 4 camas, USD 115.000.", "", "https://portal.test/depto", "", "", "Activo", "Depto Prueba · 4 camas", "Alojamiento", "Añelo", 115000, 810000, -0.07, "450 m² cubiertos · 900 m² terreno · 7 unidades", "", "", "", "", "", "", "2026-09-30", "2026-10-01", "Precio inconsistente", ""]);
  s.addRow(["RAD-ACT-903", "2026-10-01", "Activos · tierra", "Hecho publicado: terreno de 6.000 m² en alquiler a ARS 3.700.000/mes.", "", "https://portal.test/terreno", "", "", "Activo", "Terreno Prueba", "Tierra", "Añelo", null, null, null, "", "", "", "", "", "", "", "2026-10-01", "2026-10-01", "No", ""]);
  s.addRow(["RAD-AOG-910", "2026-09-29", "AOG · Conversación 1", "YPF", "Cargo: Compras. Apertura: ¿Qué servicio sigue siendo difícil?", "https://aog.test", "", "Tano", "Evento/AOG"]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Radar");
  const src = (await pool.query(`insert into sources (workspace_id, kind, title) values ($1, 'documento', 'x') returning id`, [ws])).rows[0].id;
  hal = (await pool.query(`insert into findings (workspace_id, source_id, kind, statement, origin, dedup_key, maturity) values ($1, $2, 'senal_de_mercado', 'Complejo Prueba: precio publicado inconsistente', 'manual', 'crm:HAL-901', 'hipotesis') returning id`, [ws, src])).rows[0].id;
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("migración del RADAR", () => {
  it("en seco anticipa sin escribir", async () => {
    const r = await migrateRadar(db, ws, await book(760000), { dryRun: true });
    expect(r).toMatchObject({ signals: { created: ["RAD-901", "RAD-ACT-901", "RAD-ACT-902", "RAD-ACT-903"] }, assets: { created: ["RAD-ACT-901", "RAD-ACT-902", "RAD-ACT-903"], review: ["RAD-ACT-902"] }, conversations: { created: 1 } });
    const { count } = await db.from("assets").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count).toBe(0);
  });

  it("migra activos con historial, precio inconsistente (no baja), fila contaminada marcada y enlaces de fórmulas", async () => {
    const r = await migrateRadar(db, ws, await book(760000), { dryRun: false });
    expect(r.assets.inconsistent).toEqual(["RAD-ACT-901"]);
    const { data: a } = await db.from("assets").select("id, radar_ref, price_status, surface_m2, land_m2, broker_text, material_change, asset_prices(amount, currency, operation, period, source_url, observed_on)").eq("workspace_id", ws).order("radar_ref");
    const byRef = Object.fromEntries(a!.map((x) => [x.radar_ref, x]));
    expect(byRef["RAD-ACT-901"]).toMatchObject({ price_status: "inconsistente", surface_m2: 415, land_m2: 1080, broker_text: "Broker Prueba" });
    expect(byRef["RAD-ACT-901"].asset_prices.map((p: { amount: number; source_url: string | null }) => [Number(p.amount), p.source_url]).sort()).toEqual([[760000, "https://portal.test/aviso-9"], [820000, null]]);
    // La fila con superficie y precio anterior de otro activo: no se cargan, se marca para revisar.
    expect(byRef["RAD-ACT-902"]).toMatchObject({ price_status: "sin_validar", surface_m2: null });
    expect(byRef["RAD-ACT-902"].asset_prices.map((p: { amount: number }) => Number(p.amount))).toEqual([115000]);
    expect(byRef["RAD-ACT-902"].material_change).toMatch(/^REVISAR/);
    expect(byRef["RAD-ACT-903"].asset_prices[0]).toMatchObject({ currency: "ARS", operation: "alquiler", period: "mes" });
    const { data: f } = await db.from("findings").select("asset_id").eq("id", hal).single();
    expect(f!.asset_id).toBe(byRef["RAD-ACT-901"].id);
    const { data: q } = await db.from("research_questions").select("code, industry").eq("workspace_id", ws);
    expect(q).toEqual([{ code: "RAD-AOG-910", industry: "AOG · YPF" }]);
    const { data: seen } = await db.from("brief_source_items").select("url").eq("workspace_id", ws);
    expect(seen!.map((x) => x.url)).toContain("https://portal.test/aviso-9");
  });

  it("reejecutar no duplica; un precio nuevo se suma al historial sin pisar el anterior", async () => {
    const r = await migrateRadar(db, ws, await book(740000), { dryRun: false });
    expect(r.signals.created).toEqual([]);
    expect(r.assets.created).toEqual([]);
    expect(r.prices.added).toBe(1);
    const { data } = await db.from("asset_prices").select("amount").eq("external_ref", "RAD-ACT-901");
    expect(data!.map((p) => Number(p.amount)).sort()).toEqual([740000, 760000, 820000]);
    const { count } = await db.from("brief_signals").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count).toBe(4);
  });
});
