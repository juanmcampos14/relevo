import type { Issue, IssueCode } from "./map";
import type { FieldChange, FieldConflict } from "./diff";
import { findCandidates } from "./dedupe";

// Triage de un lote del CRM: la atención humana va a las excepciones, no a confirmar normalidad.
// Una misma función decide qué muestra la revisión y qué aprueba "Aprobar lote": no pueden divergir.
//   importable → entra con el lote (nuevo sin coincidencias, o cambio del Sheet en campos que RELEVO no tocó)
//   revisar    → alguien tiene que mirarlo (conflicto, posible duplicado, cambio material, dato dudoso)
//   bloqueado  → no se importa hasta corregirlo en el Sheet

export type Lane = "importable" | "revisar" | "bloqueado";

export type TriageRow = {
  id: string;
  entity_type: string;
  external_id: string;
  action: string;
  decision: string;
  raw: { label?: string };
  mapped: { values: Record<string, unknown> };
  issues: Issue[];
  conflicts: { updates?: FieldChange[]; conflicts?: FieldConflict[] };
  resolution?: { issues?: Record<string, string>; fields?: Record<string, string> };
};

/** key agrupa en el resumen; text es lo que se muestra en la fila. */
export type Reason = { key: string; text: string };
export type Triage = { lane: Lane; reasons: Reason[] };

/** Campos que identifican al registro: si el Sheet los cambia, no es un cambio de rutina. */
export const MATERIAL_FIELDS: Record<string, string[]> = {
  company: ["trade_name", "website", "public_phone"],
  contact: ["full_name", "email", "phone", "company_ref"],
  task: ["company_ref"],
  source: ["url", "entity_ref"],
};

const FIELD: Record<string, string> = {
  trade_name: "nombre", website: "sitio web", public_phone: "teléfono", full_name: "nombre", email: "email", phone: "teléfono",
  company_ref: "empresa", url: "URL", entity_ref: "entidad vinculada",
};

/** Qué pasa con cada aviso, en una línea (para el resumen del lote). */
export const ISSUE_LABEL: Record<IssueCode, string> = {
  id_inestable: "ID que cambió de fila",
  dato_en_campo_incorrecto: "dato en un campo que no corresponde",
  fuente_texto_libre: "fuente citada como texto (no es un SRC): se registra como fuente del CRM",
  fuente_inexistente: "fuente que no está en FUENTES: se usa el CRM como fuente",
  estado_texto_libre: "estado de evidencia en texto libre",
  canal_institucional: "cargo o buzón, no una persona identificada",
  fuente_sin_entidad: "fuente de contexto, no apunta a una empresa",
  responsable_compartido: "responsable compartido: se asigna a la primera persona",
  responsable_desconocido: "responsable que no es miembro: queda sin asignar",
  referencia_rota: "referencia a un registro que no existe",
  posible_duplicado: "posible duplicado",
  propietario_sin_validar: "propietario mencionado: queda en notas, sin validar",
  sin_nombre: "sin nombre",
  sin_empresa: "persona sin empresa: queda en Calidad para vincularla",
  duplicado_en_archivo: "misma empresa que otra fila del archivo",
  alias_cambiado: "ID unificado con otro registro que cambió en el Sheet",
};

/** Empresas nuevas del mismo archivo que parecen la misma (el cruce con RELEVO ya viene del staging). */
function duplicatesInBatch(rows: TriageRow[]): Map<string, string[]> {
  const news = rows.filter((r) => r.entity_type === "company" && r.action === "crear");
  const pool = news.map((r) => ({
    id: r.id,
    name: String(r.mapped.values.trade_name ?? r.raw.label ?? ""),
    locality: (r.mapped.values.locality as string | null) ?? null,
    website: (r.mapped.values.website as string | null) ?? null,
    phone: (r.mapped.values.public_phone as string | null) ?? null,
  }));
  const out = new Map<string, string[]>();
  for (const me of pool) {
    const c = findCandidates(me, pool).filter((x) => x.reason !== "nombre_parecido");
    if (c.length) out.set(me.id, c.map((x) => `${x.name} (${x.reason.replace(/_/g, " ")})`));
  }
  return out;
}

export function triageBatch(rows: TriageRow[]): Map<string, Triage> {
  const dupes = duplicatesInBatch(rows);
  const out = new Map<string, Triage>();
  for (const r of rows) {
    if (r.action === "sin_cambios") continue;
    if (r.action === "rechazar" || r.issues.some((i) => i.severity === "bloquea")) {
      const reasons = r.issues.filter((i) => i.severity === "bloquea").map((i) => ({ key: cap(ISSUE_LABEL[i.code]), text: i.message }));
      out.set(r.id, { lane: "bloqueado", reasons: reasons.length ? reasons : [{ key: "Sin ID", text: "La fila no tiene ID." }] });
      continue;
    }
    const reasons: Reason[] = [];
    for (const c of r.conflicts.conflicts ?? []) reasons.push({ key: "Cambió en RELEVO y en el Sheet", text: `Cambió en RELEVO y en el Sheet: ${FIELD[c.field] ?? c.field}.` });
    for (const i of r.issues) if (i.severity === "revisar") reasons.push({ key: i.code === "posible_duplicado" ? "Posible duplicado de una empresa de RELEVO" : i.code === "duplicado_en_archivo" ? "Posible duplicado dentro del archivo" : cap(ISSUE_LABEL[i.code]), text: i.message });
    const d = r.issues.some((i) => i.code === "duplicado_en_archivo") ? undefined : dupes.get(r.id);
    if (d) reasons.push({ key: "Posible duplicado dentro del archivo", text: `Otra fila del archivo parece la misma empresa: ${d.join(", ")}.` });
    const material = (r.conflicts.updates ?? []).filter((u) => MATERIAL_FIELDS[r.entity_type]?.includes(u.field));
    if (material.length) reasons.push({ key: "Cambio en un dato que identifica al registro", text: `Cambia un dato que lo identifica: ${material.map((u) => FIELD[u.field] ?? u.field).join(", ")}.` });
    out.set(r.id, reasons.length ? { lane: "revisar", reasons } : { lane: "importable", reasons: [] });
  }
  return out;
}

export type BatchSummary = {
  importable: { total: number; byKind: Record<string, number>; notes: { code: IssueCode; label: string; count: number }[] };
  revisar: { total: number; byReason: { label: string; count: number }[] };
  bloqueado: { total: number; byReason: { label: string; count: number }[] };
};

const KIND: Record<string, [string, string]> = {
  company: ["empresa nueva", "empresas nuevas"],
  contact: ["persona o canal nuevo", "personas o canales nuevos"],
  task: ["actividad nueva", "actividades nuevas"],
  source: ["fuente nueva", "fuentes nuevas"],
};
const KIND_UPDATE: Record<string, [string, string]> = {
  company: ["empresa con cambios del Sheet", "empresas con cambios del Sheet"],
  contact: ["persona con cambios del Sheet", "personas con cambios del Sheet"],
  task: ["actividad con cambios del Sheet", "actividades con cambios del Sheet"],
  source: ["fuente con cambios del Sheet", "fuentes con cambios del Sheet"],
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Resumen del lote para decidir antes de aprobar: qué entra, qué hay que mirar, qué no entra y por qué. */
export function summarize(rows: TriageRow[], triage: Map<string, Triage>): BatchSummary {
  const pending = rows.filter((r) => triage.has(r.id) && (r.decision === "pendiente" || triage.get(r.id)!.lane === "bloqueado"));
  const imp = pending.filter((r) => triage.get(r.id)!.lane === "importable");
  const byKind: Record<string, number> = {};
  for (const r of imp) {
    const [one, many] = (r.action === "crear" ? KIND : KIND_UPDATE)[r.entity_type] ?? [r.entity_type, r.entity_type];
    byKind[`${one}|${many}`] = (byKind[`${one}|${many}`] ?? 0) + 1;
  }
  const notes = new Map<IssueCode, number>();
  for (const r of imp) for (const code of new Set(r.issues.filter((i) => i.severity === "info").map((i) => i.code))) notes.set(code, (notes.get(code) ?? 0) + 1);
  const group = (lane: Lane) => {
    const m = new Map<string, number>();
    const rs = pending.filter((r) => triage.get(r.id)!.lane === lane);
    for (const r of rs) {
      const keys = new Set(triage.get(r.id)!.reasons.map((x) => x.key));
      for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return { total: rs.length, byReason: [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) };
  };
  return {
    importable: {
      total: imp.length,
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, n]) => [n === 1 ? k.split("|")[0] : k.split("|")[1], n])),
      notes: [...notes].map(([code, count]) => ({ code, label: ISSUE_LABEL[code], count })).sort((a, b) => b.count - a.count),
    },
    revisar: group("revisar"),
    bloqueado: group("bloqueado"),
  };
}
