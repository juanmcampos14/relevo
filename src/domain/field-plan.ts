// RUTA | VISITAS y AOG | MAPA FÍSICO del CRM → paradas de la agenda de campo, con la clasificación aprobada
// (docs/13 §7, aprobada el 08/10): una empresa solo cuando el CRM trae un ID que existe; un punto MAP es una
// ubicación (u organización si el mapa lo marca institucional); una cámara es una organización; una
// sesión de AOG es un evento; los recorridos son actividad de campo. Nada se vincula por parecido de nombre.

export type StopClass = "empresa" | "ubicacion" | "organizacion" | "sesion" | "recorrido" | "a_definir" | "logistica" | "empresa_sin_id";
export type StopKind = "empresa" | "lugar" | "organizacion" | "evento" | "zona" | "libre";

export const KIND_OF: Record<StopClass, StopKind> = {
  empresa: "empresa",
  ubicacion: "lugar",
  organizacion: "organizacion",
  sesion: "evento",
  recorrido: "zona",
  a_definir: "libre",
  logistica: "libre",
  empresa_sin_id: "libre",
};

export type FieldRow = { row: number; values: Record<string, string | null> };

export type FieldStop = {
  /** Identidad estable de la parada (fila del CRM + empresa cuando la fila nombra varias). */
  ref: string;
  /** Fila del CRM de la que sale (para la huella y el delta). */
  rowId: string;
  day: string | null;
  position: number;
  cls: StopClass;
  kind: StopKind;
  label: string;
  companyRef: string | null;
  timeSlot: string | null;
  objective: string | null;
  keyQuestion: string | null;
  outcome: string | null;
  crmStatus: string | null;
  notes: string | null;
};

const MONTHS: Record<string, string> = { ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06", JUL: "07", AGO: "08", SEP: "09", SEPT: "09", OCT: "10", NOV: "11", DIC: "12" };
const t = (v: string | null | undefined) => (v ?? "").trim() || null;

/** "19 OCT" o "20 OCT · 11:00–13:00" → 2026-10-19 (el año es el de la misión). */
export function fieldDay(v: string | null | undefined, year: number): string | null {
  const m = /^(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]{3,4})\b/.exec((v ?? "").trim());
  const mm = m ? MONTHS[m[2].toUpperCase()] : undefined;
  return m && mm ? `${year}-${mm}-${m[1].padStart(2, "0")}` : null;
}

const ids = (v: string | null | undefined, re: RegExp) => [...new Set(((v ?? "").toUpperCase().match(re) ?? []))];
const LOGISTICA = /^(log[ií]stica|s[ií]ntesis|cierre|traslado|vuelo|buffer|desayuno \+ check-out)/i;
const ACCESO_LOGISTICA = /^(s[ií]ntesis|traslado|agenda|buffer)/i;

/** Clasificación de una fila de RUTA | VISITAS (sin empresas válidas: esas se resuelven antes). */
export function routeClass(v: Record<string, string | null>, mapCategory: string | null): Exclude<StopClass, "empresa" | "empresa_sin_id"> {
  if (mapCategory !== null) return /institucional/i.test(mapCategory) ? "organizacion" : "ubicacion";
  if (LOGISTICA.test(t(v["Vertical"]) ?? "") || ACCESO_LOGISTICA.test(t(v["Acceso recomendado"]) ?? "")) return "logistica";
  if (/^AOG\b/i.test(t(v["Bloque"]) ?? "")) return "sesion";
  if (/^seg[uú]n se[nñ]al/i.test(t(v["Zona"]) ?? "") || /^a definir/i.test(t(v["Estado visita"]) ?? "")) return "a_definir";
  return "recorrido";
}

/**
 * RUTA | VISITAS. `companies`: IDs de EMPRESAS que existen; `maps`: ID MAP → categoría del mapa.
 * Una fila con varias empresas válidas da una parada por empresa (misma franja); sin ID válido, una parada
 * clasificada. La identidad de la fila es Día + Orden (la pestaña no tiene ID propio).
 */
export function routeStops(rows: FieldRow[], o: { year: number; companies: Set<string>; maps: Map<string, string> }): FieldStop[] {
  const out: FieldStop[] = [];
  for (const r of rows) {
    const v = r.values;
    const label = t(v["Punto de visita"]);
    const dayText = t(v["Día"]);
    if (!label || !dayText) continue;
    const order = Number.parseInt(t(v["Orden"]) ?? "", 10);
    const rowId = `RUTA:${dayText.toUpperCase()}#${Number.isFinite(order) ? order : r.row}`;
    const base = {
      rowId,
      day: fieldDay(dayText, o.year),
      position: Number.isFinite(order) ? order : r.row,
      label,
      timeSlot: t(v["Franja"]),
      objective: t(v["Objetivo de aprendizaje"]),
      keyQuestion: t(v["Pregunta clave"]),
      outcome: t(v["Hallazgo / conclusión"]),
      crmStatus: t(v["Estado visita"]),
      notes: [t(v["Zona"]), t(v["Dirección / ubicación"]), t(v["Próxima acción"]) ? `Próxima acción: ${t(v["Próxima acción"])}` : null].filter(Boolean).join(" · ") || null,
    };
    const valid = ids(v["ID CRM"], /AN-\d{3,4}/g).filter((id) => o.companies.has(id));
    if (valid.length) {
      for (const id of valid) out.push({ ...base, ref: `${rowId}:${id}`, cls: "empresa", kind: "empresa", companyRef: id });
      continue;
    }
    const map = ids(v["ID CRM"], /MAP-\d{3}/g).find((id) => o.maps.has(id)) ?? null;
    const cls = routeClass(v, map ? (o.maps.get(map) ?? "") : null);
    out.push({ ...base, ref: rowId, cls, kind: KIND_OF[cls], companyRef: null });
  }
  return out;
}

/**
 * AOG | MAPA FÍSICO: la pestaña tiene dos tablas. Actores (encabezado "Actor"): con ID válido son empresas;
 * sin ID, organizaciones si su rol es de originador / cámara, y si no "empresa sin ID" (candidata al CRM, no
 * se crea). Sesiones (encabezado "Quién / empresa"): eventos.
 */
export function aogStops(actors: FieldRow[], sessions: FieldRow[], o: { year: number; companies: Set<string>; eventDay: string }): FieldStop[] {
  const out: FieldStop[] = [];
  actors.forEach((r, i) => {
    const v = r.values;
    const actor = t(v["Actor"]);
    if (!actor) return;
    const rowId = `AOG:${actor.toUpperCase()}`;
    const valid = ids(v["CRM"], /AN-\d{3,4}/g).filter((id) => o.companies.has(id));
    const role = t(v["Rol misión"]);
    const cls: StopClass = valid.length ? "empresa" : /originator|c[aá]mara/i.test(role ?? "") ? "organizacion" : "empresa_sin_id";
    out.push({
      ref: rowId,
      rowId,
      day: fieldDay(v["Día sugerido"], o.year) ?? o.eventDay,
      position: 100 + i,
      cls,
      kind: KIND_OF[cls],
      label: actor,
      companyRef: valid[0] ?? null,
      timeSlot: null,
      objective: t(v["Objetivo"]),
      keyQuestion: null,
      outcome: null,
      crmStatus: t(v["Estado"]),
      notes: [t(v["Stand oficial"]) ? `Stand ${t(v["Stand oficial"])}` : null, t(v["Zona física"]), role ? `Rol: ${role}` : null, t(v["Contacto / acceso"]) ? `Contacto: ${t(v["Contacto / acceso"])}` : null].filter(Boolean).join(" · ") || null,
    });
  });
  sessions.forEach((r, i) => {
    const v = r.values;
    const who = t(v["Quién / empresa"]);
    const when = t(v["Día / hora"]);
    if (!who || !when) return;
    const rowId = `AOG-SESION:${when.toUpperCase()}|${who.toUpperCase()}`;
    out.push({
      ref: rowId,
      rowId,
      day: fieldDay(when, o.year) ?? o.eventDay,
      position: 200 + i,
      cls: "sesion",
      kind: "evento",
      label: who,
      companyRef: null,
      timeSlot: when.replace(/^\d{1,2}\s+\S+\s*·\s*/, "") || null,
      objective: t(v["Por qué importa a misión"]),
      keyQuestion: null,
      outcome: null,
      crmStatus: null,
      notes: t(v["Prioridad"]) ? `Prioridad ${t(v["Prioridad"])}` : null,
    });
  });
  return out;
}
