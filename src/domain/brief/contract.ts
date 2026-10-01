import { z } from "zod";

// Contrato del Morning Brief, independiente del modelo: cualquier motor (Claude hoy, otro mañana)
// tiene que devolver exactamente esta forma. RELEVO la valida, la cruza con su memoria y la guarda;
// el email y la pantalla son dos representaciones del mismo objeto.

/** Verticales del mapa de investigación (presentación "16 verticales"). Taxonomía todavía en revisión: se guardan como texto. */
export const BRIEF_VERTICALS = [
  "Viandas / catering",
  "Ferreterías + suministros industriales",
  "Farmacias + salud",
  "Gomerías + neumáticos",
  "Lavaderos de vehículos",
  "Estaciones de servicio",
  "Lavandería industrial",
  "Limpieza + facility",
  "Alojamiento + campamentos",
  "Repuestos / talleres",
  "Logística + almacenamiento",
  "Comercio cotidiano",
  "Trabajadores + familias",
  "Construcción + mantenimiento",
  "Servicios industriales",
  "Software + automatización",
  "Inmuebles / activos / fondos de comercio",
  "Transversal",
] as const;

export const SIGNAL_TYPES = [
  "inversion", "obra", "contratacion", "empleo", "infraestructura", "logistica", "demanda", "nuevo_negocio",
  "activo_inmueble", "regulacion", "precio", "movimiento_empresa", "otro",
] as const;

export const SIGNAL_TYPE_LABEL: Record<(typeof SIGNAL_TYPES)[number], string> = {
  inversion: "Inversión", obra: "Obra", contratacion: "Contratación", empleo: "Empleo", infraestructura: "Infraestructura",
  logistica: "Logística", demanda: "Demanda", nuevo_negocio: "Nuevo negocio", activo_inmueble: "Activo / inmueble",
  regulacion: "Regulación", precio: "Precio", movimiento_empresa: "Movimiento de empresa", otro: "Otro",
};

export const BASIS_LABEL = { hecho: "HECHO", declaracion: "DECLARACIÓN", inferencia: "INFERENCIA RELEVO" } as const;
export const CHANGE_LABEL = { nuevo: "NUEVO", actualizado: "ACTUALIZADO", confirmado: "CONFIRMADO", contradicho: "CONTRADICHO", descartado: "DESCARTADO" } as const;
export const SECTION_LABEL = { general: "Señales del día", anelo: "Añelo: pulso local", empresas: "Empresas en movimiento", activos: "Radar de activos + negocios" } as const;

/** Referencia a una historia: el uuid de una existente o "nueva:<clave>" para abrir una. */
const StoryRef = z.string().describe("uuid de una historia existente, 'nueva:<clave-corta>' para abrir una, o '' si es un hecho aislado");

export const DraftSignal = z.object({
  key: z.string().describe("clave corta única en este brief, p. ej. s1"),
  headline: z.string(),
  summary: z.string().describe("qué pasó, en 1–2 frases"),
  happened_on: z.string().describe("YYYY-MM-DD o ''"),
  source_url: z.string().describe("URL de la nota o fuente primaria; '' si no hay"),
  source_title: z.string(),
  publisher: z.string(),
  basis: z.enum(["hecho", "declaracion", "inferencia"]),
  signal_type: z.enum(SIGNAL_TYPES),
  section: z.enum(["general", "anelo", "empresas", "activos"]),
  geography: z.string().describe("lugar concreto: Añelo, ruta 7, Loma Campana…; '' si no aplica"),
  vertical: z.enum(BRIEF_VERTICALS),
  subsector: z.string(),
  roles: z.array(z.string()).describe("rol de los actores: operadora, contratista, proveedor, comprador, broker, propietario, desarrollador…"),
  companies: z.array(z.string()),
  people: z.array(z.string()),
  why_it_matters: z.string().describe("por qué importa para lo que busca RELEVO"),
  reading: z.string().describe("lectura RELEVO (inferencia, marcada como tal)"),
  change: z.enum(["nuevo", "actualizado", "confirmado", "contradicho", "descartado"]),
  relevance: z.enum(["alta", "media", "baja"]),
  story_ref: StoryRef,
  related_company_ids: z.array(z.string()).describe("ids de EMPRESAS DE RELEVO de la lista de memoria"),
  related_finding_ids: z.array(z.string()).describe("ids de HIPÓTESIS de la lista de memoria"),
  related_campaign_ids: z.array(z.string()),
  related_asset_ids: z.array(z.string()),
  suggested_action: z.string().describe("'' si no corresponde"),
  verify: z.string().describe("qué falta comprobar para que esto importe (o '' )"),
  talk_to: z.string().describe("con quién hablar: rol, empresa o persona de la memoria (o '')"),
  ask: z.string().describe("qué preguntar en AOG o en terreno (o '')"),
});

export const BriefDraft = z.object({
  headline_points: z.array(z.object({ text: z.string(), signal_keys: z.array(z.string()) })).describe("LO QUE IMPORTA HOY: máximo 5"),
  signals: z.array(DraftSignal).describe("5–8 señales realmente relevantes (menos si el día fue tranquilo)"),
  stories: z.array(z.object({ ref: StoryRef, title: z.string(), summary: z.string().describe("estado actual de la historia") })).describe("historias tocadas hoy (nuevas o actualizadas)"),
  connections: z.array(z.object({ text: z.string(), signal_keys: z.array(z.string()), memory_refs: z.array(z.string()).describe("'tipo:uuid' de la memoria (company, finding, campaign, asset, contact)") })),
  actions: z.array(z.object({ title: z.string(), why: z.string(), signal_keys: z.array(z.string()) })).describe("QUÉ HARÍA RELEVO HOY: 3–5, priorizadas"),
  field_questions: z.array(z.object({ question: z.string(), vertical: z.enum(BRIEF_VERTICALS), why: z.string() })),
  watchlist: z.array(z.object({ story_ref: StoryRef, title: z.string(), why: z.string() })),
  candidates: z.array(z.object({ kind: z.enum(["empresa", "persona", "activo", "fuente", "relacion"]), name: z.string(), detail: z.string(), source_url: z.string() })),
  quiet_day_note: z.string().describe("'' salvo que no haya cambios relevantes: entonces decilo en una frase"),
});
export type BriefDraft = z.infer<typeof BriefDraft>;
export type DraftSignalT = z.infer<typeof DraftSignal>;

/** Lo que se guarda en briefs.content y se renderiza (pantalla y email). */
export type BriefSignalView = Omit<DraftSignalT, "related_company_ids" | "related_finding_ids" | "related_campaign_ids" | "related_asset_ids" | "story_ref"> & {
  id: string;
  story_id: string | null;
  story_title: string | null;
  company_ids: string[];
  finding_ids: string[];
};
export type VerticalRadarRow = { vertical: string; signals: number; contradictions: number; companies: string[]; hypotheses: number; questions: string[]; next: string[] };
export type BriefContent = {
  headline_points: BriefDraft["headline_points"];
  signals: BriefSignalView[];
  connections: BriefDraft["connections"];
  actions: BriefDraft["actions"];
  field_questions: BriefDraft["field_questions"];
  watchlist: { story_id: string | null; title: string; why: string; since: string | null }[];
  candidates: (BriefDraft["candidates"][number] & { id: string })[];
  vertical_radar: VerticalRadarRow[];
  changes: Record<keyof typeof CHANGE_LABEL, { key: string; headline: string }[]>;
  sources: { url: string; title: string; publisher: string | null }[];
  quiet_day_note: string;
  /** Cómo salió esta corrida (para leerla y para saber si gastar más mejora el brief). */
  metrics?: BriefMetrics;
};
export type BriefMetrics = {
  mode: "completo" | "reducido";
  costUsd: number;
  monthCostUsd: number;
  monthlyCapUsd: number;
  collected: number;
  collectedVmn: number;
  sourcesCited: number;
  sourcesCitedVmn: number;
  webSearches: number;
  signals: number;
  signalsVmn: number;
  stories: number;
  watchlist: number;
  candidates: number;
};

// Forma que viaja al modelo: vertical y tipo como texto (el límite de gramática de las salidas
// estructuradas no admite los enums largos repetidos); RELEVO los normaliza contra la lista controlada.
export const WireSignal = DraftSignal.extend({ vertical: z.string(), signal_type: z.string() });
export const WireDraft = BriefDraft.extend({
  signals: z.array(WireSignal),
  field_questions: z.array(z.object({ question: z.string(), vertical: z.string(), why: z.string() })),
});
export type WireDraft = z.infer<typeof WireDraft>;

const foldKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const VERTICAL_BY_KEY = new Map(BRIEF_VERTICALS.map((v) => [foldKey(v), v]));

/** Vertical controlada: coincidencia exacta o por prefijo con la lista; si no, "Transversal" (texto libre nunca crea una vertical). */
export function normalizeVertical(v: string): (typeof BRIEF_VERTICALS)[number] {
  const k = foldKey(v);
  if (VERTICAL_BY_KEY.has(k)) return VERTICAL_BY_KEY.get(k)!;
  const hit = BRIEF_VERTICALS.find((x) => k && (foldKey(x).startsWith(k) || k.startsWith(foldKey(x).split(" ")[0])));
  return hit ?? "Transversal";
}
export function normalizeSignalType(t: string): (typeof SIGNAL_TYPES)[number] {
  const k = foldKey(t).replace(/ /g, "_");
  return (SIGNAL_TYPES as readonly string[]).includes(k) ? (k as (typeof SIGNAL_TYPES)[number]) : "otro";
}
export function fromWire(w: WireDraft): BriefDraft {
  return {
    ...w,
    signals: w.signals.map((s) => ({ ...s, vertical: normalizeVertical(s.vertical), signal_type: normalizeSignalType(s.signal_type) })),
    field_questions: w.field_questions.map((q) => ({ ...q, vertical: normalizeVertical(q.vertical) })),
  };
}

export const MAX = { headline: 5, signals: 8, actions: 5, questions: 5, candidates: 8, connections: 5 } as const;
