// Field MVP · Bloque A: el modelo representa la realidad de campo. Contra Postgres real con RLS (Tano owner
// de la misión, Fran puede trabajar, Jenny fuera de la misión).
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { addParty, candidateView, createCandidate, setCardSection } from "@/server/opportunities/candidate";
import { nextAction } from "@/server/next-action";
import { ingestPatch, lockAfterHumanEdit } from "@/server/locks";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const pw = randomUUID();
const tag = randomUUID().slice(0, 8);
const people = { tano: `tano-${tag}@test.local`, fran: `fran-${tag}@test.local`, jenny: `jenny-${tag}@test.local` };
type Who = keyof typeof people;
let ws: string, vm: string, plan: string, target: string, ids: Record<Who, string>, db: Record<Who, SupabaseClient<Database>>;

async function signIn(email: string) {
  const c = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}

beforeAll(async () => {
  ws = await createWorkspace(pool, "Field MVP");
  ids = {} as never;
  for (const [k, email] of Object.entries(people)) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    if (error) throw error;
    ids[k as Who] = data.user.id;
  }
  await pool.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')`, [ws, ids.tano, ids.fran, ids.jenny]);
  db = { tano: await signIn(people.tano), fran: await signIn(people.fran), jenny: await signIn(people.jenny) };
  vm = (await db.tano.from("campaigns").insert({ workspace_id: ws, name: "Vaca Muerta / Añelo", kind: "mision", status: "activa" }).select("id").single()).data!.id;
  await db.tano.from("mission_invitations").insert({ workspace_id: ws, campaign_id: vm, email: people.fran, role: "member", invited_by: ids.tano });
  await db.fran.rpc("accept_pending_invitations");
  const olivia = (await db.tano.from("companies").insert({ workspace_id: ws, trade_name: "Olivia Catering", origin_campaign_id: vm }).select("id").single()).data!.id;
  target = (await db.tano.from("campaign_targets").insert({ workspace_id: ws, campaign_id: vm, company_id: olivia }).select("id").single()).data!.id;
  plan = (await db.tano.from("visit_plans").insert({ workspace_id: ws, campaign_id: vm, title: "Añelo · día 3", planned_on: "2026-10-18" }).select("id").single()).data!.id;
});
afterAll(async () => {
  await cleanup(pool, [ws], Object.entries(people).map(([k, email]) => ({ id: ids[k as Who], email })));
  await pool.end();
});

describe("parada generalizada", () => {
  it("una jornada real: empresa, zona, lugar, evento y actividad libre, todas operables", async () => {
    const stops = [
      { kind: "zona", label: "Parque Industrial Añelo", time_slot: "09:00", objective: "Ver galpones y quién opera", key_question: "¿Qué base operativa falta?", external_ref: "MAP-029" },
      { kind: "empresa", target_id: target, time_slot: "Mediodía", objective: "Entender capacidad de viandas", key_question: "¿Qué turno queda sin cubrir?", external_ref: "AN-0067" },
      { kind: "lugar", label: "Cruce RP7 / RP17", latitude: -38.35, longitude: -68.79, time_slot: "12:00", external_ref: "MAP-030" },
      { kind: "evento", label: "AOG Patagonia · Día 1", time_slot: "Todo el día", external_ref: "RUTA-22" },
      { kind: "libre", label: "Broker / inmobiliaria local · por identificar", time_slot: "16:30", external_ref: "RUTA-35" },
    ].map((s, position) => ({ workspace_id: ws, plan_id: plan, position, ...s }));
    const { error } = await db.fran.from("visit_stops").insert(stops as never);
    expect(error).toBeNull();
    // Reglas: una empresa necesita su objetivo; un lugar, un nombre.
    expect((await db.fran.from("visit_stops").insert({ workspace_id: ws, plan_id: plan, position: 9, kind: "empresa" } as never)).error?.code).toBe("23514");
    expect((await db.fran.from("visit_stops").insert({ workspace_id: ws, plan_id: plan, position: 9, kind: "lugar" } as never)).error?.code).toBe("23514");
    // Estados del campo: en curso y cancelada.
    const { data: zona } = await db.fran.from("visit_stops").select("id").eq("external_ref", "MAP-029").single();
    expect((await db.fran.from("visit_stops").update({ status: "en_curso" }).eq("id", zona!.id)).error).toBeNull();
    const { data: ev } = await db.fran.from("visit_stops").select("id").eq("external_ref", "RUTA-22").single();
    expect((await db.fran.from("visit_stops").update({ status: "cancelada", outcome: "AOG se pasó al día 2" }).eq("id", ev!.id)).error).toBeNull();
    // Jenny no está en la misión: no ve la jornada.
    expect((await db.jenny.from("visit_stops").select("id").eq("plan_id", plan)).data).toEqual([]);
  });

  it("lo que se captura en una parada sabe de qué parada salió, y su próxima acción también", async () => {
    const { data: stop } = await db.tano.from("visit_stops").select("id").eq("external_ref", "AN-0067").single();
    const { data: cap, error } = await db.tano.from("captures").insert({ workspace_id: ws, campaign_id: vm, stop_id: stop!.id, client_id: randomUUID(), captured_at: new Date().toISOString(), body: "Olivia no cubre el turno noche." } as never).select("id, stop_id").single();
    expect(error).toBeNull();
    expect(cap!.stop_id).toBe(stop!.id);
    await db.tano.from("tasks").insert({ workspace_id: ws, campaign_id: vm, stop_id: stop!.id, target_id: target, title: "Volver con la propuesta de turno noche", due_on: "2026-10-20" });
    expect(await nextAction(db.tano, { stop: stop!.id })).toMatchObject({ source: "task", title: "Volver con la propuesta de turno noche" });
  });
});

describe("precedencia humana", () => {
  it("lo que una persona corrigió no lo pisa una ingesta: queda como 'información diferente'", async () => {
    const { data: a } = await db.tano.from("assets").insert({ workspace_id: ws, title: "Espacio Añelo · 1.040 m²", kind: "inmueble", origin_campaign_id: vm } as never).select("*").single();
    await lockAfterHumanEdit(db.tano, "assets", a!.id, { ...a, title: "Espacio Añelo declara 1.040 m²" }, { title: "Espacio Añelo · 1.040 m²" });
    const { data: cur } = await admin.from("assets").select("*").eq("id", a!.id).single();
    expect(cur!.locked_fields).toEqual(["title"]);
    const r = await ingestPatch(admin, { workspaceId: ws, table: "assets", id: a!.id, current: cur!, incoming: { title: "Espacio Añelo declara 1.040 m², 100% construido", locality: "Añelo" }, source: "radar_sheet", sourceRef: "RAD-HOU-02" });
    expect(r.apply).toEqual({ locality: "Añelo" });
    // Reimportar no duplica la discrepancia.
    await ingestPatch(admin, { workspaceId: ws, table: "assets", id: a!.id, current: cur!, incoming: { title: "Espacio Añelo declara 1.040 m², 100% construido" }, source: "radar_sheet", sourceRef: "RAD-HOU-02" });
    const { data: d } = await db.tano.from("source_discrepancies").select("field, current_value, incoming_value, source, status").eq("entity_id", a!.id);
    expect(d).toEqual([{ field: "title", current_value: "Espacio Añelo · 1.040 m²", incoming_value: "Espacio Añelo declara 1.040 m², 100% construido", source: "radar_sheet", status: "pendiente" }]);
  });
});

describe("candidato: el caso de la lavandería", () => {
  it("representa empresa, dueño, cliente, pagador, capacidad, unidad kg, limitante, evidencia a favor y en contra, PARTNER, riesgos, qué falta y la próxima acción", async () => {
    const t = db.tano;
    const lav = (await t.from("companies").insert({ workspace_id: ws, trade_name: "Lavandería del Valle", origin_campaign_id: vm }).select("id").single()).data!.id;
    const hotel = (await t.from("companies").insert({ workspace_id: ws, trade_name: "Hotel Ruta 7", origin_campaign_id: vm }).select("id").single()).data!.id;
    const rival = (await t.from("companies").insert({ workspace_id: ws, trade_name: "Lavadero Sur", origin_campaign_id: vm }).select("id").single()).data!.id;
    const dueno = (await t.from("contacts").insert({ workspace_id: ws, full_name: "Raúl (dueño)", network_roles: ["dueno"], origin_campaign_id: vm } as never).select("id").single()).data!.id;
    await t.from("contact_links").insert({ workspace_id: ws, contact_id: dueno, company_id: lav, relation: "dueno" });
    const ev = async (statement: string, company: string, stated?: string) =>
      (await t.from("evidence").insert({ workspace_id: ws, campaign_id: vm, statement, evidence_type: "declaracion", origin_kind: "field", company_id: company, stated_by_contact_id: stated ?? null }).select("id").single()).data!.id;
    const eCap = await ev("Procesa 700 kg/día sobre 1.000 kg de capacidad.", lav, dueno);
    const eRej = await ev("Rechaza ~200 kg/día en picos.", lav, dueno);
    const eHotel = await ev("El hotel necesita un proveedor de lavandería.", hotel);
    const eRival = await ev("Lavadero Sur planea sumar 500 kg/día en seis meses.", rival);
    // Greenfield no exige empresa; validada exige aprobación.
    expect((await t.from("opportunities").insert({ workspace_id: ws, campaign_id: vm, title: "Lavandería industrial nueva", lane: "greenfield", gap: "Faltan kg/día en picos" }).select("id").single()).error).toBeNull();
    expect((await t.from("opportunities").insert({ workspace_id: ws, campaign_id: vm, title: "x", maturity: "validada" }).select("id").single()).error?.code).toBe("23514");

    const opp = await createCandidate(t, { workspaceId: ws, campaignId: vm, title: "Asociarse con Lavandería del Valle", lane: "negocio_existente", route: "participacion", companyId: lav, economicUnit: "kg" });
    await setCardSection(t, opp, "capacidad", { status: "sabido", evidence_ids: [eCap, eRej], against_ids: [eRival], values: [
      { variable: "capacidad_nominal", value: "1000", unit: "kg/día", basis: "declarado", evidence_ids: [eCap] },
      { variable: "utilizacion", value: "700", unit: "kg/día", basis: "declarado", evidence_ids: [eCap] },
      { variable: "demanda_rechazada", value: "200", unit: "kg/día", basis: "declarado", evidence_ids: [eRej] },
      { variable: "capacidad_futura", value: "500", unit: "kg/día", basis: "declarado", evidence_ids: [eRival], about: "Lavadero Sur" },
    ] });
    await setCardSection(t, opp, "demanda", { status: "sabido", summary: "Un hotel confirma que necesita proveedor; se rechazan kg en picos.", evidence_ids: [eHotel, eRej], against_ids: [], values: [] });
    await setCardSection(t, opp, "limitante", { status: "sabido", summary: "Equipamiento y capital de trabajo.", evidence_ids: [eCap], against_ids: [], values: [] });
    await setCardSection(t, opp, "economics", { status: "creido", evidence_ids: [eCap], against_ids: [], values: [{ variable: "precio_unidad", value: "X", unit: "ARS/kg", basis: "declarado", evidence_ids: [eCap] }] });
    await setCardSection(t, opp, "riesgos", { status: "creido", summary: "Competidor suma capacidad; posible baja de precio.", evidence_ids: [eRival], against_ids: [], values: [] });
    await addParty(t, { workspaceId: ws, opportunityId: opp, role: "operador", companyId: lav });
    await addParty(t, { workspaceId: ws, opportunityId: opp, role: "socio_potencial", contactId: dueno, note: "Dispuesto a incorporar un socio" });
    await addParty(t, { workspaceId: ws, opportunityId: opp, role: "consumidor", companyId: hotel, evidenceId: eHotel });
    await addParty(t, { workspaceId: ws, opportunityId: opp, role: "pagador", companyId: hotel });
    await addParty(t, { workspaceId: ws, opportunityId: opp, role: "competidor", companyId: rival, evidenceId: eRival });
    await t.from("tasks").insert({ workspace_id: ws, campaign_id: vm, opportunity_id: opp, contact_id: dueno, title: "Pedirle a Raúl el costo por kg y la necesidad de capital", due_on: "2026-10-21" });

    const v = await candidateView(t, opp);
    expect(v.opportunity).toMatchObject({ lane: "negocio_existente", route: "participacion", maturity: "candidato", economic_unit: "kg", company_id: lav });
    expect(v.state.gap).toMatchObject({ gapNow: true, gapAfterFuture: false });
    expect(v.state.contradicted).toEqual(["capacidad"]);
    expect(v.state.missingParties).toEqual(["decisor"]);
    expect(v.state.missing).toEqual(["negocio", "palanca", "proxima_validacion"]);
    expect(v.state.nextQuestion).toBeTruthy();
    expect(await nextAction(t, { opportunity: opp })).toMatchObject({ title: "Pedirle a Raúl el costo por kg y la necesidad de capital" });
    expect(await nextAction(t, { company: lav })).toMatchObject({ source: "task" }); // por el dueño vinculado
    // Lo que no es de la misión no se ve: Jenny no ve las partes.
    expect((await db.jenny.from("opportunity_parties").select("id").eq("opportunity_id", opp)).data).toEqual([]);
    expect((await db.fran.from("opportunity_parties").select("id").eq("opportunity_id", opp)).data).toHaveLength(5);
  });
});

describe("rol de red", () => {
  it("una persona puede ser originadora (cómo accedemos al territorio); los roles son un catálogo cerrado", async () => {
    const ok = await db.tano.from("contacts").insert({ workspace_id: ws, full_name: "Enrique García", network_roles: ["originador", "referidor"], origin_campaign_id: vm } as never).select("network_roles").single();
    expect(ok.data!.network_roles).toEqual(["originador", "referidor"]);
    expect((await db.tano.from("contacts").insert({ workspace_id: ws, full_name: "X", network_roles: ["influencer"] } as never)).error?.code).toBe("23514");
  });
});
