// Field MVP · Bloque B: una fuente nueva no se importa, se reconcilia. Contra Postgres real. La IA es falsa
// (devuelve la extracción y el juicio que daría el modelo) y se cuenta qué se le pide.
import ExcelJS from "exceljs";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { addParty, createCandidate, setCardSection } from "@/server/opportunities/candidate";
import { ingestDocument } from "@/server/reconcile/source";
import { reconcileRadar } from "@/server/radar/reconcile";
import { cleanup, createWorkspace, newPool } from "./harness";

const pool = newPool();
const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, vm: string, lav: string, rival: string, opp: string;

/** IA falsa: la extracción de documentos para "DOCUMENTO:", el juicio para lo demás. */
function fakeAI(extract: unknown, judge: (prompt: string) => unknown) {
  const calls: string[] = [];
  const client = { beta: { messages: { parse: async (req: { messages: { content: string }[] }) => {
    const p = req.messages[0].content;
    calls.push(p);
    return { stop_reason: "end_turn", parsed_output: p.startsWith("DOCUMENTO:") ? extract : judge(p), usage: { input_tokens: 1, output_tokens: 1 } };
  } } } } as unknown as Anthropic;
  return { client, calls };
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Reconciliación");
  vm = (await pool.query(`insert into campaigns (workspace_id, name, kind, status) values ($1, 'Vaca Muerta / Añelo', 'mision', 'activa') returning id`, [ws])).rows[0].id;
  lav = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Lavandería del Valle') returning id`, [ws])).rows[0].id;
  rival = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Lavadero Sur') returning id`, [ws])).rows[0].id;
  const hotel = (await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Hotel Ruta 7') returning id`, [ws])).rows[0].id;
  // Lo que sabíamos: demanda rechazada ~200 kg/día; sin noticias de capacidad nueva.
  opp = await createCandidate(db, { workspaceId: ws, campaignId: vm, title: "Asociarse con Lavandería del Valle", lane: "negocio_existente", route: "participacion", companyId: lav, economicUnit: "kg/día" });
  await setCardSection(db, opp, "capacidad", { status: "creido", evidence_ids: [], against_ids: [], values: [
    { variable: "capacidad_nominal", value: "1000", unit: "kg/día", basis: "estimado", evidence_ids: [] },
    { variable: "utilizacion", value: "700", unit: "kg/día", basis: "estimado", evidence_ids: [] },
    { variable: "demanda_rechazada", value: "200", unit: "kg/día", basis: "estimado", evidence_ids: [] },
  ] });
  await setCardSection(db, opp, "demanda", { status: "creido", summary: "Un hotel necesita proveedor.", evidence_ids: [], against_ids: [], values: [] });
  await addParty(db, { workspaceId: ws, opportunityId: opp, role: "consumidor", companyId: hotel });
  await addParty(db, { workspaceId: ws, opportunityId: opp, role: "pagador", companyId: hotel });
});
afterAll(async () => {
  await cleanup(pool, [ws], []);
  await pool.end();
});

describe("caso lavandería: le doy un documento a RELEVO y entiende qué cambia", () => {
  it("reconoce al competidor (sin duplicarlo), cuestiona la brecha, dice qué falta y propone validar — sin promover ni descartar", async () => {
    const extraction = { facts: [{ statement: "Lavadero Sur SRL planea sumar 500 kg/día de capacidad en seis meses.", basis: "declaracion", entities: [{ kind: "empresa", name: "Lavadero Sur SRL", role: "competidor" }], values: [{ variable: "capacidad_futura", value: "500", unit: "kg/día", about: "Lavadero Sur" }] }] };
    const ai = fakeAI(extraction, () => ({ items: [{ key: "doc-1", same_as: "", material: true, triage: "importa", why: "Un competidor suma capacidad: puede cerrar la brecha que creíamos.", finding_refs: [], candidate_refs: [`opportunity:${opp}`], next_action: "", watch: "" }] }));
    const { count: oppsBefore } = await db.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    const run = await ingestDocument(db, { workspaceId: ws, missionId: vm, title: "Notas de Fran · lavanderías", text: "Lavadero Sur SRL planea sumar 500 kg/día en seis meses.", client: ai.client });
    const o = run.outcomes[0];

    // Reconciliación: el competidor ya existía (no se crea "Lavadero Sur SRL").
    expect(o.reconciledAgainst).toContain("empresa Lavadero Sur");
    expect(o.created).not.toContain("empresa Lavadero Sur SRL");
    expect((await db.from("companies").select("id").eq("workspace_id", ws).ilike("trade_name", "Lavadero Sur%")).data).toHaveLength(1);
    // Qué sabía antes → qué aprendió → qué cambia → qué no sabe → qué recomienda.
    const i = o.impact[0];
    expect(i.before).toMatch(/200 kg\/día/);
    expect(i.learned).toMatch(/500 kg\/día/);
    expect(i.effect).toBe("La existencia de una brecha real queda cuestionada.");
    expect(i.stillUnknown).toEqual(expect.arrayContaining(["cuánta de la capacidad anunciada está realmente disponible y cuándo", "precio y costo por unidad", "quién decide", "cómo gana plata y sus contratos"]));
    expect(i.nextQuestion).toMatch(/capacidad nueva/);
    expect(o.contradiction).toMatch(/cuestionada/);
    expect(o.material).toBe(true);
    // La ficha: el dato nuevo es evidencia EN CONTRA de la brecha; el competidor queda como parte.
    const { data: card } = await db.from("opportunities").select("card, maturity, status").eq("id", opp).single();
    const cap = (card!.card as { capacidad: { against_ids: string[]; values: { variable: string; about: string | null }[] } }).capacidad;
    expect(cap.values.find((v) => v.variable === "capacidad_futura")?.about).toBe("Lavadero Sur");
    expect(cap.against_ids).toHaveLength(1);
    expect((await db.from("opportunity_parties").select("role, company_id").eq("opportunity_id", opp).eq("role", "competidor")).data).toEqual([{ role: "competidor", company_id: rival }]);
    // Salida natural: una tarea canónica ligada al candidato y a la señal. Nada se promovió ni se creó otra oportunidad.
    const { data: tasks } = await db.from("tasks").select("title, opportunity_id, signal_id, kind").in("id", o.taskIds);
    expect(tasks).toEqual([expect.objectContaining({ opportunity_id: opp, signal_id: o.signalId, kind: "Validación" })]);
    expect(card!.maturity).toBe("candidato");
    expect(card!.status).toBe("candidata");
    expect((await db.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", ws)).count).toBe(oppsBefore);
    // Queda el registro de la fuente, fila por fila.
    const { data: rows } = await db.from("import_rows").select("action, conflicts, mapped").eq("batch_id", run.batchId!);
    expect(rows).toHaveLength(1);
    expect(rows![0].action).toBe("conflicto");
  });
});

describe("Radar reconciliado", () => {
  const H = ["ID", "Fecha", "Tema", "Hallazgo", "Implicación hipotética RELEVO", "Enlace", "Estado validación", "Acción / responsable", "Tipo de señal", "Activo / entidad", "Categoría del activo", "Ubicación", "Precio actual USD", "Precio anterior USD", "Variación", "Capacidad / superficie", "Ocupación declarada", "Propietario", "Broker / contacto", "Operador / inquilino", "Motivo de venta", "Economics disponibles", "Primera detección", "Última comprobación", "Cambio material", "Capa de evidencia"];
  async function book(): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("RADAR DE MERCADO");
    s.addRow(H);
    s.addRow(["RAD-INF-03", "2026-10-04", "Infraestructura", "Hecho publicado: Neuquén realizará una prueba piloto de bitrenes durante seis meses sobre RP17 entre Plaza Huincul y Añelo.", "Puede cambiar la logística de arenas", "https://neuqueninforma.test/bitrenes", "Fuente pública", "Mapear transportistas", "Infraestructura"]);
    s.addRow(["RAD-MKT-02", "2026-10-01", "Mercado", "Neuquén exportó USD 803 M en energía en agosto.", "Usar como contexto de escala, no como oportunidad.", "https://adnsur.test/803", "Fuente pública", "", "Mercado"]);
    s.addRow(["RAD-ACT-10", "2026-10-02", "Activos · industrial", "Galpón 450 m² sobre predio 5.000 m² en Añelo; alquiler USD 10.000/mes + IVA.", "Benchmark de renta industrial", "https://www.zonaprop.test/propiedades/clasificado/galpon-1.html", "Publicación", "", "Activo", "Galpón 450 m² · Parque Industrial Añelo", "Industrial", "Parque Industrial · Añelo", 10000, null, null, "450 m² cubiertos · 5.000 m² terreno", "", "", "", "", "", "", "2026-10-02", "2026-10-02", "No", ""]);
    return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  }

  it("un hecho que ya sabíamos es una fuente más; el contexto entra sin ruido; una publicación no es una oportunidad", async () => {
    // Lo que el Brain ya sabía de los bitrenes (otro medio, otras palabras).
    const known = (await db.from("brief_signals").insert({ workspace_id: ws, origin: "vigilancia", basis: "hecho", signal_type: "otro", section: "general", headline: "Vialidad anuncia prueba piloto de bitrenes entre Plaza Huincul y Añelo", change: "nuevo", relevance: "alta", campaign_ids: [vm], happened_on: "2026-10-05" } as never).select("id").single()).data!.id;
    const ai = fakeAI(null, () => ({ items: [
      { key: "RAD-INF-03", same_as: `hecho:${known}`, material: false, triage: "next", why: "Ya lo sabíamos por la vigilancia.", finding_refs: [], candidate_refs: [], next_action: "", watch: "" },
      { key: "RAD-MKT-02", same_as: "", material: false, triage: "next", why: "Contexto de escala.", finding_refs: [], candidate_refs: [], next_action: "", watch: "" },
      { key: "RAD-ACT-10", same_as: "", material: false, triage: "seguir", why: "Los galpones salieron del foco; seguimos el precio como referencia.", finding_refs: [], candidate_refs: [], next_action: "", watch: "Renta de galpones en el Parque Industrial" },
    ] }));
    const { count: oppsBefore } = await db.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    // En seco: no escribe nada.
    const dry = await reconcileRadar(db, { workspaceId: ws, missionId: vm, buffer: await book(), fileName: "radar.xlsx", dryRun: true, client: ai.client });
    expect(dry.run.outcomes.map((o) => [o.key, o.action, o.triage])).toEqual([["RAD-INF-03", "sin_cambios", "next"], ["RAD-MKT-02", "crear", "next"], ["RAD-ACT-10", "crear", "seguir"]]);
    expect((await db.from("brief_signals").select("id").eq("workspace_id", ws).not("external_ref", "is", null)).data).toEqual([]);

    const run = await reconcileRadar(db, { workspaceId: ws, missionId: vm, buffer: await book(), fileName: "radar.xlsx", dryRun: false, client: ai.client });
    const { data: sig } = await db.from("brief_signals").select("external_ref, event_id, material, status").eq("workspace_id", ws).not("external_ref", "is", null).order("external_ref");
    expect(sig).toEqual([
      { external_ref: "RAD-ACT-10", event_id: null, material: false, status: "seguida" },
      { external_ref: "RAD-INF-03", event_id: known, material: false, status: "procesada" },
      { external_ref: "RAD-MKT-02", event_id: null, material: false, status: "procesada" },
    ]);
    // El activo existe (publicación, sin verificar); el pedido de aviso quedó; ninguna oportunidad nueva.
    expect(run.import.assets.created).toEqual(["RAD-ACT-10"]);
    const { data: m } = await db.from("campaigns").select("watch").eq("id", vm).single();
    expect((m!.watch as { criteria: { text: string }[] }).criteria.map((c) => c.text)).toContain("Renta de galpones en el Parque Industrial");
    expect((await db.from("opportunities").select("id", { count: "exact", head: true }).eq("workspace_id", ws)).count).toBe(oppsBefore);
    // Reimportar no duplica: las filas ya son conocidas.
    const again = await reconcileRadar(db, { workspaceId: ws, missionId: vm, buffer: await book(), fileName: "radar.xlsx", dryRun: true, client: ai.client });
    expect(again.run.outcomes).toEqual([]);
  });
});
