// Candidato / oportunidad: "hay suficiente evidencia para profundizar", no una inversión aprobada. La
// ficha se completa progresivamente desde la evidencia (no es un formulario): cada sección dice qué
// sabemos, qué creemos y qué falta; la UX muestra lo que sabemos, lo que falta, qué importa ahora y qué
// preguntar después. Sin campos por vertical: la unidad económica y los valores son libres. Puro y testeable.

import * as z from "zod/v4";

export const MATURITIES = ["candidato", "cuantificando", "validando", "validada", "caso_inversion"] as const;
export type Maturity = (typeof MATURITIES)[number];
export const MATURITY_LABEL: Record<Maturity, string> = { candidato: "Candidato", cuantificando: "Cuantificando", validando: "Validando", validada: "Oportunidad validada", caso_inversion: "Caso de inversión" };

/** Carril de captura de valor: invertir en algo que existe o crear algo nuevo sobre una brecha validada. */
export const LANES = ["negocio_existente", "greenfield", "a_definir"] as const;
export type Lane = (typeof LANES)[number];
/** BUY / PARTNER / CREATE / CONNECT sobre las rutas existentes. */
export const ROUTE_LABEL = { adquisicion: "Comprar (BUY)", participacion: "Asociarse (PARTNER)", alianza: "Asociarse (PARTNER)", gestion: "Gestionar", creacion_propia: "Crear (CREATE)", conexion: "Conectar (CONNECT)", a_definir: "A definir" } as const;

export const PARTY_ROLES = ["consumidor", "decisor", "pagador", "operador", "proveedor", "competidor", "socio_potencial"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const SECTIONS = ["negocio", "demanda", "limitante", "capacidad", "palanca", "economics", "riesgos", "proxima_validacion"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  negocio: "Negocio", demanda: "Demanda", limitante: "Limitante", capacidad: "Capacidad", palanca: "Palanca",
  economics: "Economics", riesgos: "Riesgos", proxima_validacion: "Próxima validación",
};

/** Variables conocidas (no exhaustivas: se aceptan otras). Capacidad y economía por unidad. */
export const CAPACITY_VARS = ["capacidad_nominal", "utilizacion", "demanda_rechazada", "capacidad_futura", "recurso_limitante"] as const;
export const UNIT_ECONOMICS_VARS = ["precio_unidad", "costo_variable_unidad", "contribucion_unidad", "break_even"] as const;

const Basis = z.enum(["observado", "declarado", "calculado", "estimado"]);
export const CardValue = z.object({
  variable: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().nullable().optional(),
  basis: Basis,
  evidence_ids: z.array(z.string()).default([]),
  /** De quién es el dato cuando no es del negocio analizado (p. ej. un competidor que suma capacidad). */
  about: z.string().nullable().optional(),
});
export const CardSection = z.object({
  status: z.enum(["sabido", "creido", "contradicho", "falta"]),
  summary: z.string().nullable().optional(),
  evidence_ids: z.array(z.string()).default([]),
  /** Evidencia en contra (contraevidencia explícita). */
  against_ids: z.array(z.string()).default([]),
  values: z.array(CardValue).default([]),
});
export const Card = z.partialRecord(z.enum(SECTIONS), CardSection);
export type CardValue = z.infer<typeof CardValue>;
export type CardSection = z.infer<typeof CardSection>;
export type Card = z.infer<typeof Card>;

/** Sin evidencia no hay "observado" ni "declarado" (pasa a estimado), como en la economía de los casos. */
export function sanitizeCard(card: Card): Card {
  const out: Card = {};
  for (const s of SECTIONS) {
    const sec = card[s];
    if (!sec) continue;
    const values = sec.values.map((v) => ({ ...v, basis: (v.basis === "observado" || v.basis === "declarado") && !v.evidence_ids.length ? ("estimado" as const) : v.basis }));
    const status = sec.status === "sabido" && !sec.evidence_ids.length && !values.some((v) => v.evidence_ids.length) ? "creido" : sec.status;
    out[s] = { ...sec, status, values };
  }
  return out;
}

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const val = (sec: CardSection | undefined, v: string, about?: string | null) => sec?.values.find((x) => x.variable === v && (about === undefined || (x.about ?? null) === about))?.value;

export type CapacityGap = {
  /** ¿Hay demanda que hoy no se atiende? (rechazada/espera, o utilización al tope). */
  gapNow: boolean | null;
  /** ¿Sigue la brecha cuando entre la capacidad futura anunciada (propia o de terceros)? */
  gapAfterFuture: boolean | null;
  explanation: string;
};

/**
 * ¿Existe una brecha entre demanda y capacidad, y sigue existiendo cuando entre la capacidad futura?
 * Usa lo que haya; lo que falta lo dice (null = no se puede saber todavía).
 */
export function capacityGap(card: Card, unit?: string | null): CapacityGap {
  const sec = card.capacidad;
  const u = unit ? ` ${unit}` : "";
  const nominal = num(val(sec, "capacidad_nominal", null));
  const used = num(val(sec, "utilizacion", null));
  const rejected = num(val(sec, "demanda_rechazada", null));
  const future = (sec?.values ?? []).filter((x) => x.variable === "capacidad_futura").reduce((a, x) => a + (num(x.value) ?? 0), 0);
  if (rejected === null && (nominal === null || used === null)) return { gapNow: null, gapAfterFuture: null, explanation: "Falta saber cuánta demanda se rechaza o la utilización contra la capacidad." };
  const gapNow = rejected !== null ? rejected > 0 : used! >= nominal! * 0.9;
  if (!gapNow) return { gapNow: false, gapAfterFuture: false, explanation: `No hay demanda rechazada${used !== null && nominal !== null ? ` (usa ${used} de ${nominal}${u})` : ""}.` };
  const unmet = rejected ?? (used !== null && nominal !== null ? used - nominal * 0.9 : 0);
  if (!future) return { gapNow: true, gapAfterFuture: null, explanation: `Se rechazan ~${unmet}${u}. Falta saber si entra capacidad nueva (propia o de un competidor).` };
  const after = unmet - future > 0;
  return { gapNow: true, gapAfterFuture: after, explanation: after ? `Se rechazan ~${unmet}${u} y la capacidad anunciada (${future}${u}) no alcanza a cubrirla.` : `Se rechazan ~${unmet}${u}, pero la capacidad anunciada (${future}${u}) podría cubrirla: la brecha puede cerrarse.` };
}

/** Qué preguntar cuando falta cada sección (genérico; los playbooks por vertical son P1). */
const QUESTION: Record<Section, string> = {
  demanda: "¿Quién lo usa, cada cuánto, y hay demanda que hoy no se atiende o espera?",
  capacidad: "¿Cuánto puede atender hoy, cuánto usa, cuánto rechaza en picos y quién suma capacidad pronto?",
  limitante: "¿Qué le impide crecer: capital, capital de trabajo, equipamiento, gestión, gente?",
  economics: "¿Cuánto cobra por unidad, cuánto le cuesta y desde qué volumen cubre costos?",
  negocio: "¿Cómo gana plata hoy y con quién tiene contratos?",
  riesgos: "¿De qué depende: un cliente, deuda, un permiso, el fundador?",
  palanca: "¿Dónde podríamos crear valor: precio, utilización, volumen, capital de trabajo, comercial?",
  proxima_validacion: "¿Qué tendría que pasar para avanzar?",
};
/** Orden de lo que importa primero en campo: sin demanda y brecha no hay caso. */
const PRIORITY: Section[] = ["demanda", "capacidad", "limitante", "economics", "negocio", "riesgos", "palanca", "proxima_validacion"];

export type CandidateState = {
  known: { section: Section; summary: string; basis: string }[];
  missing: Section[];
  /** Lo que más importa resolver ahora. */
  focus: Section | null;
  /** La próxima pregunta concreta. */
  nextQuestion: string | null;
  /** ¿Están consumidor, decisor y pagador? */
  missingParties: PartyRole[];
  gap: CapacityGap;
  contradicted: Section[];
};

/** Lo que sabemos, lo que falta, qué importa ahora y qué preguntar después (sin mostrar la ficha entera). */
export function candidateState(card: Card, parties: { role: PartyRole }[], unit?: string | null): CandidateState {
  const c = sanitizeCard(card);
  const known = SECTIONS.flatMap((s) => {
    const sec = c[s];
    if (!sec || sec.status === "falta") return [];
    const summary = sec.summary?.trim() || sec.values.map((v) => `${v.variable.replace(/_/g, " ")}: ${v.value}${v.unit ? ` ${v.unit}` : ""}`).join(" · ");
    return summary ? [{ section: s, summary, basis: sec.status }] : [];
  });
  const missing = SECTIONS.filter((s) => !c[s] || c[s]!.status === "falta");
  const roles = new Set(parties.map((p) => p.role));
  const missingParties = (["consumidor", "decisor", "pagador"] as const).filter((r) => !roles.has(r));
  const gap = capacityGap(c, unit);
  // La capacidad "sabida" sin poder responder la brecha sigue siendo lo que falta.
  const open = PRIORITY.filter((s) => missing.includes(s) || (s === "capacidad" && gap.gapNow !== null && gap.gapAfterFuture === null));
  const focus = open[0] ?? null;
  const nextQuestion = focus ? QUESTION[focus] : missingParties.length ? `¿Quién ${missingParties.map((r) => (r === "consumidor" ? "lo usa" : r === "decisor" ? "decide" : "paga")).join(", quién ")}?` : null;
  return { known, missing, focus, nextQuestion, missingParties, gap, contradicted: SECTIONS.filter((s) => c[s]?.status === "contradicho" || (c[s]?.against_ids.length ?? 0) > 0) };
}

/** Mezcla una sección nueva sobre la ficha (lo que llega reemplaza la sección; los valores se suman por variable). */
export function mergeSection(card: Card, section: Section, next: CardSection): Card {
  const prev = card[section];
  if (!prev) return { ...card, [section]: next };
  const values = [...prev.values.filter((v) => !next.values.some((n) => n.variable === v.variable && (n.about ?? null) === (v.about ?? null))), ...next.values];
  return {
    ...card,
    [section]: { ...prev, ...next, values, evidence_ids: [...new Set([...prev.evidence_ids, ...next.evidence_ids])], against_ids: [...new Set([...prev.against_ids, ...next.against_ids])] },
  };
}
