// El Sheet operativo como fuente viva: cada sincronización procesa solo lo que cambió. Libro real (xlsx)
// armado en el test; base real con RLS desactivada por el cliente admin (como el cron). La IA es falsa.
import ExcelJS from "exceljs";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { syncSheet } from "@/server/sheet/sync";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const SHEET = `sheet-${Date.now()}`;
let ws: string, vm: string, knownBitrenes: string;

const RADAR_H = ["ID", "Fecha", "Tema", "Hallazgo", "Implicación hipotética RELEVO", "Enlace", "Estado validación", "Acción / responsable", "Tipo de señal", "Activo / entidad"];
type Company = { id: string; name: string; notes?: string };
async function book(o: { companies: Company[]; radar: string[][] }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const e = wb.addWorksheet("EMPRESAS");
  e.addRow(["ID anterior", "ID", "Empresa / establecimiento", "Sector", "Localidad / zona", "Prioridad", "Notas"]);
  for (const c of o.companies) e.addRow([c.id, c.id, c.name, "Servicios", "Añelo", "Media", c.notes ?? ""]);
  wb.addWorksheet("RED | CONTACTOS").addRow(["ID", "Nombre", "Empresa ID", "Acceso / vínculo"]);
  wb.addWorksheet("ACTIVIDADES").addRow(["ID", "Empresa ID", "Actividad / objetivo"]);
  wb.addWorksheet("FUENTES").addRow(["ID", "Entidad vinculada", "URL original"]);
  const r = wb.addWorksheet("RADAR DE MERCADO");
  r.addRow(RADAR_H);
  for (const row of o.radar) r.addRow(row);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
const BYPASS = ["RAD-901", "2026-09-29", "Infraestructura", "Adjudicado el bypass de Añelo", "Contexto de tránsito", "https://ejemplo.test/bypass", "Fuente pública", "", "Infraestructura", ""];
const BITRENES = ["RAD-902", "2026-10-06", "Infraestructura", "Hecho publicado: prueba piloto de bitrenes entre Plaza Huincul y Añelo, seis meses sobre RP17.", "Logística de arenas", "https://neuqueninforma.test/bitrenes", "Fuente pública", "", "Infraestructura", ""];

/** Juicio falso: contexto para todo, salvo lo que ya sabíamos (bitrenes = mismo hecho). */
function judge() {
  const calls: string[] = [];
  const client = { beta: { messages: { parse: async (req: { messages: { content: string }[] }) => {
    const p = req.messages[0].content;
    calls.push(p);
    const items = [...p.matchAll(/"key":"(RAD-\d+)"/g)].map((m) => ({ key: m[1], same_as: m[1] === "RAD-902" ? `hecho:${knownBitrenes}` : "", material: false, triage: "contexto", why: m[1] === "RAD-902" ? "Ya lo sabíamos." : "Contexto.", finding_refs: [], candidate_refs: [], next_action: "", watch: "" }));
    return { stop_reason: "end_turn", parsed_output: { items }, usage: { input_tokens: 1, output_tokens: 1 } };
  } } } } as unknown as Anthropic;
  return { client, calls };
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Sheet vivo");
  vm = (await pool.query(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'Vaca Muerta / Añelo', 'mision', 'activa') returning id`, [ws])).rows[0].id;
  knownBitrenes = (await db.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "otro", section: "general", headline: "Vialidad anuncia prueba piloto de bitrenes entre Plaza Huincul y Añelo", change: "nuevo", relevance: "alta", campaign_ids: [vm], happened_on: "2026-10-05" } as never).select("id").single()).data!.id;
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("Sheet vivo: RELEVO procesa solo lo que cambió", () => {
  it("primera vez procesa todo; sin cambios no hace nada; a las 14:00 el research agrega filas y RELEVO reconcilia solo el delta", async () => {
    // 1. Primera sincronización: todo es nuevo.
    const v1 = await book({ companies: [{ id: "AN-9101", name: "Lavandería del Valle", notes: "Ficha comercial" }], radar: [BYPASS] });
    const s1 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: v1, trigger: "prueba", client: judge().client });
    expect(s1.status).toBe("procesado");
    expect(s1.changed).toEqual({ EMPRESAS: { nuevas: ["AN-9101"], modificadas: [] }, "RADAR DE MERCADO": { nuevas: ["RAD-901"], modificadas: [] } });
    const lav = (await db.from("companies").select("id").eq("workspace_id", ws).eq("trade_name", "Lavandería del Valle").single()).data!.id;

    // Una persona corrige la ficha en RELEVO.
    await db.from("companies").update({ notes: "Dueño: Raúl. Rechaza ~200 kg/día en picos (visita 06/10)." }).eq("id", lav);

    // 2. Mismo Sheet: no se procesa nada (ni se llama a la IA).
    const ai2 = judge();
    const s2 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: v1, trigger: "prueba", client: ai2.client });
    expect(s2).toMatchObject({ status: "sin_cambios", changed: {}, batchIds: [] });
    expect(ai2.calls).toHaveLength(0);

    // 3. 14:00: el research agrega una empresa nueva, una que es la misma que ya conocemos con otro nombre,
    //    edita la nota de la que una persona corrigió, y suma una nota del Radar sobre algo que ya sabíamos.
    const v2 = await book({
      companies: [
        { id: "AN-9101", name: "Lavandería del Valle", notes: "Ficha comercial; validar propietario" },
        { id: "AN-9102", name: "Lavandería del Valle SRL Añelo" },
        { id: "AN-9103", name: "Gomería Ruta 7" },
      ],
      radar: [BYPASS, BITRENES],
    });
    const ai3 = judge();
    const s3 = await syncSheet(db, { workspaceId: ws, missionId: vm, sheetId: SHEET, buffer: v2, modifiedAt: "2026-10-06T17:00:00Z", trigger: "prueba", client: ai3.client });
    expect(s3.status).toBe("procesado");
    // Solo el delta: el bypass no se vuelve a procesar.
    expect(s3.changed).toEqual({ EMPRESAS: { nuevas: ["AN-9102", "AN-9103"], modificadas: ["AN-9101"] }, "RADAR DE MERCADO": { nuevas: ["RAD-902"], modificadas: [] } });
    expect(ai3.calls.join(" ")).not.toContain("RAD-901");
    // La empresa nueva entra; la que es la misma con otro nombre NO se crea (queda para revisar).
    const names = (await db.from("companies").select("trade_name").eq("workspace_id", ws)).data!.map((c) => c.trade_name).sort();
    expect(names).toEqual(["Gomería Ruta 7", "Lavandería del Valle"]);
    expect(s3.result.crm!.paraRevisar).toBeGreaterThanOrEqual(1);
    // La corrección humana no se pisa: lo que trae el Sheet queda como información diferente.
    const { data: lavNow } = await db.from("companies").select("notes").eq("id", lav).single();
    expect(lavNow!.notes).toMatch(/Raúl/);
    const { data: diff } = await db.from("source_discrepancies").select("field, current_value, incoming_value, source").eq("entity_id", lav).eq("status", "pendiente");
    expect(diff).toEqual([expect.objectContaining({ field: "notes", source: "google_sheets", incoming_value: expect.stringMatching(/validar propietario/) })]);
    // Lo que ya sabíamos es una fuente más, no una novedad; no genera trabajo.
    const { data: bit } = await db.from("brief_signals").select("event_id, material, status").eq("external_ref", "RAD-902").single();
    expect(bit).toEqual({ event_id: knownBitrenes, material: false, status: "procesada" });
    expect(s3.result.radar).toMatchObject({ creadas: 0, reconciliadas: 1, material: 0, tareas: 0 });
    // Trazabilidad: cada corrida con qué cambió y qué hizo.
    const { data: runs } = await db.from("sheet_syncs").select("status, trigger, sheet_modified_at").eq("workspace_id", ws).order("started_at");
    expect(runs!.map((r) => r.status)).toEqual(["procesado", "sin_cambios", "procesado"]);
    const { data: seen } = await db.from("sheet_rows").select("tab, external_id, last_batch_id").eq("workspace_id", ws).order("external_id");
    expect(seen!.map((x) => `${x.tab}:${x.external_id}`)).toEqual(["EMPRESAS:AN-9101", "EMPRESAS:AN-9102", "EMPRESAS:AN-9103", "RADAR DE MERCADO:RAD-901", "RADAR DE MERCADO:RAD-902"]);
  });
});
