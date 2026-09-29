// Importador del CRM de punta a punta (docs/03-migracion-crm-sheets.md), con un usuario real y RLS:
// staging → revisión → aplicación → reimportación sin duplicar → edición en RELEVO → conflicto → resolución.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import type { RawRow } from "@/domain/crm-import/map";
import type { ParsedWorkbook } from "@/server/crm-import/parse";
import { WorkbookError, parseCrmWorkbook } from "@/server/crm-import/parse";
import { stageImport } from "@/server/crm-import/stage";
import { applyBatch } from "@/server/crm-import/apply";
import { decideRow } from "@/server/crm-import/review";
import { cleanup, createWorkspace, newPool } from "./harness";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const pool = newPool();
const admin = createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
let ws: string, userId: string, db: SupabaseClient<Database>;
const email = `tano-import-${randomUUID().slice(0, 8)}@test.local`;
const password = randomUUID();

const RUN = randomUUID();
const r = (sheet: string, row: number, values: Record<string, string | null>): RawRow => ({ sheet, row, values });
function workbook(over: { hotelNext?: string; hotelNotes?: string } = {}): ParsedWorkbook {
  return {
    formulaIds: ["RED | CONTACTOS"],
    rows: {
      companies: [
        r("EMPRESAS", 27, {
          "ID anterior": "AN-9023", ID: "AN-9023", "Empresa / establecimiento": "Hotel Prueba", Sector: "Alojamiento", Subsector: "Hotel + viandas",
          "Localidad / zona": "Añelo", Dirección: "RP7 y RP17", Prioridad: "Alta", "Etapa CRM": "Investigación",
          "Estado de evidencia": "Fuente pública pendiente revalidación", "Fuente ID": "SRC-9001", Responsable: "Tano",
          "Próxima acción": over.hotelNext ?? "Identificar decisor", "Fecha próxima acción": "05/10/2026", Notas: over.hotelNotes ?? "Nota original",
        }),
        r("EMPRESAS", 58, {
          "ID anterior": "AN-9054", ID: "AN-9054", "Empresa / establecimiento": "Modular Prueba", Prioridad: "Alta", Responsable: "Tano",
          "Estado de evidencia": "Verificado públicamente · expositor AOG 2026 + operación Neuquén", "Fuente ID": `AOG Patagonia 2026 / sitio oficial ${RUN}`, "Última verificación": "2026-09-29",
        }),
        r("EMPRESAS", 45, { "ID anterior": "AN-9041", ID: "AN-9041", "Empresa / establecimiento": "Constructora Prueba", Sector: "Contratista industrial", Prioridad: "Media", "Teléfono público": "https://constructora.example/" }),
      ],
      contacts: [r("RED | CONTACTOS", 9, { ID: "CT-9005", Nombre: "Administración (cargo; persona por identificar)", "Empresa ID": "AN-9023", Cargo: "Administración", "Acceso / vínculo": "Buzón institucional", Correo: "admin@hotel.example", "Fuente / referencia": "SRC-9001" })],
      tasks: [r("ACTIVIDADES", 4, { ID: "ACT-9003", "Empresa ID": "AN-9023", "Contacto ID": "CT-9005", Tipo: "Correo", "Actividad / objetivo": "Solicitar reunión", Responsable: "Tano + Fran", Vencimiento: "2026-10-02", Estado: "Pendiente", Canal: "Gmail" })],
      sources: [
        r("FUENTES", 2, { ID: "SRC-9001", "Entidad vinculada": "AN-9023", Tipo: "Directorio de negocios", "Título / evidencia": "Hotel Prueba, ficha pública", "URL original": `https://maps.example/${RUN}`, "Fecha consulta": "2026-09-27", Calidad: "Media", "Hecho que sustenta": "Existencia, categoría y teléfono" }),
        r("FUENTES", 3, { ID: "SRC-9004", "Entidad vinculada": "Mercado", Tipo: "Gobierno provincial", "Título / evidencia": "Bypass Añelo", "URL original": `https://gob.example/${RUN}`, Calidad: "Alta" }),
      ],
    },
  };
}

async function approveAll(batch: string) {
  const { data: rows } = await db.from("import_rows").select("id, issues, conflicts, decision").eq("batch_id", batch).eq("decision", "pendiente");
  for (const row of rows ?? []) {
    const issues = Object.fromEntries((row.issues as { severity: string; proposal?: unknown }[]).map((i, idx) => [idx, i.proposal ? ("aplicar" as const) : undefined]).filter(([, v]) => v));
    const fields = Object.fromEntries(((row.conflicts as { conflicts?: { field: string }[] }).conflicts ?? []).map((c) => [c.field, "relevo" as const]));
    const res = await decideRow(db, row.id, "aprobada", { issues, fields }, userId);
    expect(res.error).toBeUndefined();
  }
}

const rowsOf = async (batch: string) =>
  (await db.from("import_rows").select("external_id, entity_type, action, decision, issues, conflicts").eq("batch_id", batch)).data ?? [];

beforeAll(async () => {
  ws = await createWorkspace(pool, "Importador");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Estanislao Prueba" } });
  if (error) throw error;
  userId = data.user.id;
  await pool.query(`update profiles set display_name = 'Estanislao Prueba' where user_id = $1`, [userId]);
  await pool.query(`insert into memberships (workspace_id, user_id, role, can_approve_decisions) values ($1, $2, 'owner', true)`, [ws, userId]);
  await pool.query(`insert into campaigns (workspace_id, name, status) values ($1, 'Añelo', 'activa')`, [ws]);
  db = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e } = await db.auth.signInWithPassword({ email, password });
  if (e) throw e;
});

afterAll(async () => {
  await cleanup(pool, [ws], [{ id: userId, email }]);
  await pool.end();
});

describe("importador del CRM", () => {
  let first: string;

  it("staging: propuestas por fila, problemas detectados y nada escrito todavía", async () => {
    first = await stageImport(db, ws, workbook(), { fileName: "crm.xlsx", sha256: "a" });
    const rows = await rowsOf(first);
    expect(rows.map((x) => `${x.entity_type}:${x.external_id}:${x.action}`).sort()).toEqual([
      "company:AN-9023:crear", "company:AN-9041:crear", "company:AN-9054:crear", "contact:CT-9005:crear", "source:SRC-9001:crear", "source:SRC-9004:crear", "task:ACT-9003:crear",
    ]);
    const codes = rows.flatMap((x) => (x.issues as { code: string }[]).map((i) => `${x.external_id}:${i.code}`));
    expect(codes).toEqual(expect.arrayContaining(["AN-9041:dato_en_campo_incorrecto", "CT-9005:canal_institucional", "SRC-9004:fuente_sin_entidad", "ACT-9003:responsable_compartido", "ACT-9003:responsable_desconocido"]));
    const { count } = await db.from("companies").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("no se puede aprobar sin decidir las propuestas a revisar", async () => {
    const { data } = await db.from("import_rows").select("id").eq("batch_id", first).eq("external_id", "CT-9005").single();
    const res = await decideRow(db, data!.id, "aprobada", {}, userId);
    expect(res.error).toMatch(/Falta decidir/);
  });

  it("aplicar: empresa con objetivo, categoría, establecimiento, persona/canal, follow-up, fuente y evidencia", async () => {
    await approveAll(first);
    const res = await applyBatch(db, ws, first);
    expect(res.errors).toEqual([]);
    expect(res.applied).toBe(7);

    // Estado con detalle + fuente en texto libre: fuente citada por el CRM + evidencia, sin perder nada.
    const { data: modular } = await db.from("companies").select("id, verification_status, sources(kind, title)").eq("trade_name", "Modular Prueba").single();
    expect(modular).toMatchObject({ verification_status: "publicly_verified", sources: { kind: "crm", title: `AOG Patagonia 2026 / sitio oficial ${RUN}` } });
    const { data: mev } = await db.from("evidence").select("statement, origin_kind, verification_status, observed_at").eq("company_id", modular!.id);
    expect(mev).toEqual([{ statement: "expositor AOG 2026 + operación Neuquén", origin_kind: "aog", verification_status: "publicly_verified", observed_at: "2026-09-29T15:00:00+00:00" }]);

    const { data: hotel } = await db.from("companies").select("id, trade_name, activity, verification_status, source_id, sources(title)").eq("trade_name", "Hotel Prueba").single();
    expect(hotel).toMatchObject({ activity: "Hotel + viandas", verification_status: "partially_verified", sources: { title: "Hotel Prueba, ficha pública" } });
    const { data: target } = await db.from("campaign_targets").select("id, status, priority, next_action, next_action_due, owner_id, target_verticals(verticals(name))").eq("company_id", hotel!.id).single();
    expect(target).toMatchObject({ status: "investigacion", priority: 1, next_action: "Identificar decisor", next_action_due: "2026-10-05", owner_id: userId, target_verticals: [{ verticals: { name: "Alojamiento" } }] });
    const { data: est } = await db.from("establishments").select("address_text, address_status").eq("company_id", hotel!.id).single();
    expect(est).toEqual({ address_text: "RP7 y RP17", address_status: "no_verificada" });

    const { data: contact } = await db.from("contacts").select("id, full_name, contact_kind, preferred_channel, contact_links(company_id)").eq("full_name", "Administración").single();
    expect(contact).toMatchObject({ contact_kind: "canal_institucional", preferred_channel: "email", contact_links: [{ company_id: hotel!.id }] });
    const { data: task } = await db.from("tasks").select("title, status, assignee_id, target_id, contact_id, description, channel").eq("title", "Solicitar reunión").single();
    expect(task).toMatchObject({ status: "todo", assignee_id: userId, target_id: target!.id, contact_id: contact!.id, channel: "Gmail" });
    expect(task!.description).toContain("Tano + Fran");

    const { data: ev } = await db.from("evidence").select("statement, verification_status, origin_kind, source_id").eq("company_id", hotel!.id);
    expect(ev).toEqual([{ statement: "Existencia, categoría y teléfono", verification_status: "partially_verified", origin_kind: "website", source_id: hotel!.source_id }]);

    const { data: fixed } = await db.from("companies").select("website, public_phone").eq("trade_name", "Constructora Prueba").single();
    expect(fixed).toEqual({ website: "https://constructora.example/", public_phone: null });
    const { count: refs } = await db.from("external_refs").select("id", { count: "exact", head: true });
    expect(refs).toBe(7);
  });

  it("reimportar el mismo archivo no duplica nada", async () => {
    const again = await stageImport(db, ws, workbook(), { fileName: "crm.xlsx", sha256: "a" });
    const rows = await rowsOf(again);
    expect(new Set(rows.map((x) => x.action))).toEqual(new Set(["sin_cambios"]));
    const edited = rows.filter((x) => (x.conflicts as { relevoEdited?: boolean }).relevoEdited).map((x) => x.external_id);
    // Difieren del Sheet solo las filas donde se aceptó una propuesta (web movida, canal institucional);
    // ni la nota de responsables compartidos ni la fecha de carga por defecto cuentan como edición.
    expect(edited.sort()).toEqual(["AN-9041", "CT-9005"]);
    const closed = await applyBatch(db, ws, again);
    expect(closed).toMatchObject({ applied: 0, unchanged: 7, errors: [] });
    const { count } = await db.from("companies").select("id", { count: "exact", head: true });
    expect(count).toBe(3);
    const { count: ev } = await db.from("evidence").select("id", { count: "exact", head: true });
    expect(ev).toBe(2);
    const { count: cited } = await db.from("sources").select("id", { count: "exact", head: true }).eq("kind", "crm").like("title", "AOG Patagonia%");
    expect(cited).toBe(1);
  });

  it("editado en RELEVO + cambiado en el Sheet: conflicto campo por campo; lo que solo cambió el Sheet se actualiza", async () => {
    const { data: hotel } = await db.from("companies").select("id").eq("trade_name", "Hotel Prueba").single();
    await db.from("campaign_targets").update({ next_action: "Llamar al gerente (editado en RELEVO)" }).eq("company_id", hotel!.id);

    const batch = await stageImport(db, ws, workbook({ hotelNext: "Visitar el hotel (Sheet)", hotelNotes: "Nota nueva en el Sheet" }), { fileName: "crm-v2.xlsx", sha256: "b" });
    const hotelRow = (await rowsOf(batch)).find((x) => x.external_id === "AN-9023")!;
    expect(hotelRow.action).toBe("conflicto");
    const c = hotelRow.conflicts as { updates: { field: string }[]; conflicts: { field: string; sheet: string; relevo: string; base: string }[] };
    expect(c.conflicts).toEqual([{ field: "next_action", base: "Identificar decisor", sheet: "Visitar el hotel (Sheet)", relevo: "Llamar al gerente (editado en RELEVO)" }]);
    expect(c.updates.map((u) => u.field)).toEqual(["notes"]);

    await approveAll(batch); // el conflicto se resuelve a favor de RELEVO
    const res = await applyBatch(db, ws, batch);
    expect(res.errors).toEqual([]);
    const { data: t } = await db.from("campaign_targets").select("next_action").eq("company_id", hotel!.id).single();
    expect(t!.next_action).toBe("Llamar al gerente (editado en RELEVO)");
    const { data: co } = await db.from("companies").select("notes").eq("id", hotel!.id).single();
    expect(co!.notes).toBe("Nota nueva en el Sheet");

    // La base ahora es lo último del Sheet: sin cambios nuevos, no reaparece el conflicto.
    const third = await stageImport(db, ws, workbook({ hotelNext: "Visitar el hotel (Sheet)", hotelNotes: "Nota nueva en el Sheet" }), { fileName: "crm-v2.xlsx", sha256: "b" });
    expect((await rowsOf(third)).find((x) => x.external_id === "AN-9023")!.action).toBe("sin_cambios");

    // Queda historial de quién cambió qué.
    const { rows: hist } = await pool.query(`select count(*)::int n from audit_log where entity_id = $1 and action = 'update'`, [hotel!.id]);
    expect(hist[0].n).toBeGreaterThan(0);
  });

  it("un archivo malformado se rechaza entero, sin tocar nada", async () => {
    await expect(parseCrmWorkbook(new TextEncoder().encode("no soy un xlsx").buffer as ArrayBuffer)).rejects.toBeInstanceOf(WorkbookError);
  });
});
