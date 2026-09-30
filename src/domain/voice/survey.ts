// Voice of Añelo · cuestionario V1 (del prototipo y voice-anelo-v1.md), puro y versionado.
// Unidad de análisis: el episodio (qué pasó, cuántas veces, cómo se resolvió, cuánto costó y quién pagó).
// Toda respuesta es DECLARACIÓN. El gasto observado y el precio hipotético se guardan en campos distintos.

export type Option = { value: string; label: string };
export type MoneyField = { key: string; label: string; kind: "observado" | "hipotetico" };
export type Question = {
  id: string;
  code: string; // VO-Qxx en INVESTIGACIÓN | ENTREVISTAS
  title: string;
  hint?: string;
  options: Option[];
  multi?: boolean;
  detail?: string; // texto libre opcional
  money?: MoneyField[];
  payer?: boolean;
  hypotheses: string[];
};
export type SurveyDefinition = {
  version: string;
  intro: { title: string; body: string[]; window: string };
  quickTap: { title: string; options: Option[] };
  eligibility: { title: string; options: Option[] };
  questions: Question[];
};

const o = (...labels: string[]): Option[] => labels.map((l) => ({ value: l.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label: l }));
const NO_SE = { value: "no_se", label: "No sé / prefiero no responder" };
const PAYER = true;

export const SURVEY_V1: SurveyDefinition = {
  version: "v1",
  intro: {
    title: "Queremos escuchar experiencias concretas",
    body: [
      "RELEVO está haciendo un relevamiento privado sobre la vida y el trabajo en Añelo. Queremos conocer experiencias concretas —también cuando algo funciona bien— para entender necesidades y orientar investigación en terreno.",
      "Participar es voluntario. No pedimos nombre, teléfono, empleador ni dirección. Analizamos las respuestas de forma agregada. Evitá incluir nombres o información confidencial.",
      "No es una encuesta representativa ni una promesa de servicios. Podés omitir cualquier pregunta o responder «no sé».",
    ],
    window: "Pensá en los últimos 30 días (o en los días que estuviste en Añelo). Gastos en pesos, aproximados.",
  },
  quickTap: {
    title: "Para empezar, un toque: ¿qué es lo que más te ocupa del día en Añelo?",
    options: [...o("Comida", "Descanso / alojamiento", "Traslados", "Compras y servicios", "Nada en particular"), { value: "sin_elegir", label: "Prefiero empezar sin elegir" }],
  },
  eligibility: {
    title: "No estuviste en Añelo en los últimos 30 días. ¿Tenés un vínculo habitual con Añelo?",
    options: [
      { value: "vivo_fuera_temporal", label: "Sí: vivo o trabajo ahí, pero este mes no fui" },
      { value: "diagrama_franco", label: "Sí: trabajo por diagrama y estuve de franco" },
      { value: "no", label: "No tengo un vínculo habitual con Añelo" },
    ],
  },
  questions: [
    { id: "exposicion", code: "VO-Q01", title: "En los últimos 30 días, ¿cuántos días estuviste en Añelo?", options: o("0", "1–5", "6–15", "16–30"), hypotheses: [] },
    {
      id: "vinculo", code: "VO-Q01", title: "¿Cuál es tu vínculo con Añelo?", hint: "Podés marcar más de uno.", multi: true,
      options: o("Vivo ahí", "Trabajo por diagrama / rotación", "Trabajo permanente ahí", "Prestación ocasional", "Visito a familia o acompaño a alguien que trabaja ahí", "Visita / paso", "Otro"),
      hypotheses: ["H-VA-13"],
    },
    {
      id: "actividad", code: "VO-Q02", title: "¿Qué actividad describe mejor lo que hacés?",
      options: o("Operación / oficio", "Técnico", "Supervisor / ingeniero / mando medio", "Comercio / servicios", "Otra", "No trabajo"), hypotheses: ["H-VA-13"],
    },
    {
      id: "descanso", code: "VO-Q03", title: "Cuando estás en Añelo, ¿dónde dormís habitualmente?",
      options: o("Vivienda propia o alquilada", "Hotel / apart", "Alojamiento de empresa / campamento", "Casa compartida / familiar", "Vuelvo a otra localidad", "Otro"),
      detail: "Localidad (sin dirección)", payer: PAYER, hypotheses: ["H-VA-09"],
    },
    {
      id: "episodio_descanso", code: "VO-Q04", title: "La última vez que necesitaste alojamiento o tuviste un problema para descansar, ¿qué pasó?",
      options: o("Ningún problema", "Disponibilidad", "Precio", "Ruido", "Limpieza", "Distancia", "Horario", "Otro"),
      detail: "¿Cómo lo resolviste? ¿Cuántas noches te afectó?", money: [{ key: "gasto_extra", label: "Gasto adicional aproximado (ARS)", kind: "observado" }], hypotheses: ["H-VA-09"],
    },
    {
      id: "comida", code: "VO-Q05", title: "En tu último día en Añelo, ¿cómo resolviste la comida principal?",
      options: o("Empresa / vianda", "Cociné", "Restaurante", "Delivery", "Compra preparada", "Otra"),
      detail: "¿A qué hora?", money: [{ key: "gasto", label: "Gasto propio aproximado (ARS)", kind: "observado" }], payer: PAYER, hypotheses: ["H-VA-01"],
    },
    {
      id: "friccion_comida", code: "VO-Q06", title: "En los últimos 30 días, ¿cuántas veces no conseguiste comida adecuada al horario que necesitabas?",
      options: o("0", "1", "2–3", "4–7", "8 o más"),
      detail: "Si pasó: contá la última vez y qué hiciste.", money: [{ key: "gasto_extra", label: "Gasto adicional aproximado (ARS)", kind: "observado" }], hypotheses: ["H-VA-01"],
    },
    {
      id: "movilidad", code: "VO-Q07", title: "¿Cómo hiciste tu último traslado habitual entre donde dormís y donde trabajás o hacés tus actividades?",
      options: o("Transporte de empresa", "Auto propio", "Auto compartido", "Taxi / remís", "Colectivo", "A pie", "Otro"),
      detail: "¿Cuánto tardaste en ir?", money: [{ key: "gasto", label: "Gasto por viaje si lo conocés (ARS)", kind: "observado" }], payer: PAYER, hypotheses: ["H-VA-11"],
    },
    {
      id: "friccion_movilidad", code: "VO-Q08", title: "En los últimos 30 días, ¿algún traslado o problema del vehículo te hizo perder tiempo?",
      options: o("No", "Sí"),
      detail: "Si pasó: contá el último, cómo se resolvió (en Añelo o afuera) y cuánto tiempo perdiste.", payer: PAYER, hypotheses: ["H-VA-04", "H-VA-10", "H-VA-11"],
    },
    {
      id: "compra_fuera", code: "VO-Q09", title: "¿Cuál fue tu última compra importante o servicio usado fuera de Añelo que podrías haber resuelto ahí?",
      options: o("Ninguno", "Alimentos", "Hogar", "Salud cotidiana", "Ropa", "Repuestos / mantenimiento", "Trámites", "Ocio", "Otro"),
      detail: "¿Dónde y por qué? (no había, horario, calidad, precio, preferencia, iba de todos modos)",
      money: [{ key: "gasto", label: "Gasto del bien o servicio, sin el viaje (ARS)", kind: "observado" }], hypotheses: ["H-VA-02", "H-VA-10", "H-VA-12"],
    },
    {
      id: "frecuencia_fuera", code: "VO-Q10", title: "Además de esa vez, ¿cuántas veces resolviste esa misma necesidad fuera de Añelo en los últimos 30 días?",
      options: o("0", "1", "2–3", "4–7", "8 o más"), hypotheses: ["H-VA-12"],
    },
    {
      id: "insatisfaccion", code: "VO-Q11", title: "De los servicios que sí usaste en Añelo, ¿cuál te dejó menos satisfecho la última vez?",
      options: o("Ninguno: estoy conforme", "Alojamiento", "Comida", "Traslados", "Compras", "Mantenimiento / reparaciones", "Salud", "Otro"),
      detail: "¿Qué pasó y cómo lo resolviste?", money: [{ key: "precio", label: "Precio pagado si lo recordás (ARS)", kind: "observado" }], hypotheses: ["H-VA-01", "H-VA-09", "H-VA-10", "H-VA-12"],
    },
    {
      id: "ocio", code: "VO-Q12", title: "En tu último tiempo libre en Añelo, ¿qué hiciste?",
      options: o("Descansé", "Deporte", "Salida gastronómica", "Reunión social", "Compras", "Actividad fuera de Añelo", "Otra", "No tuve tiempo libre"),
      detail: "¿Dónde?", money: [{ key: "gasto", label: "Gasto propio aproximado (ARS)", kind: "observado" }], hypotheses: ["H-VA-13"],
    },
    {
      id: "prioridad", code: "VO-Q13", title: "De lo que contaste, ¿qué te hizo perder más tiempo o dinero?",
      options: o("Ninguno", "Descanso", "Comida", "Traslados / vehículo", "Compra o servicio fuera", "Otro servicio"),
      detail: "Tiempo perdido aproximado (minutos u horas).", money: [{ key: "gasto_extra", label: "Gasto extra aproximado (ARS)", kind: "observado" }], hypotheses: [],
    },
    {
      id: "alternativa", code: "VO-Q14", title: "Para ese problema, ¿cuánto pagás hoy y cuál fue la última alternativa real que consideraste?",
      options: o("Consideré otra alternativa", "No había otra alternativa", "No busqué alternativas"),
      detail: "¿Cuál alternativa? ¿Por qué unidad pagás (noche, viaje, comida…)?",
      money: [
        { key: "gasto_actual", label: "Lo que pagás hoy, por unidad (ARS)", kind: "observado" },
        { key: "precio_hipotetico", label: "Opcional: si existiera una alternativa en Añelo, ¿hasta cuánto pagarías por esa misma unidad? (ARS)", kind: "hipotetico" },
      ],
      payer: PAYER, hypotheses: ["H-VA-12"],
    },
    { id: "abierta", code: "VO-Q15", title: "Si mañana apareciera una sola cosa nueva en Añelo que te hiciera la vida más fácil, ¿qué elegirías?", options: [], detail: "Una sola cosa, con tus palabras.", hypotheses: [] },
  ],
};

export const PAYERS: Option[] = [...o("Yo", "Mi empleador", "Compartido", "Me lo reintegran"), NO_SE];
export const DAYS_ZERO = "0";

export type Answer = { choice?: string | null; choices?: string[]; detail?: string; money?: Record<string, number | null>; payer?: string | null; omitted?: boolean; skipped?: string };
export type Answers = { quick_tap?: string | null; eligibility?: string | null; items: Record<string, Answer> };

/** Próxima pregunta según las ramificaciones (null = fin). "fuera" = cierre por fuera de alcance. */
export function nextStep(def: SurveyDefinition, current: string | "inicio", a: Answers): string | "elegibilidad" | "fuera" | null {
  const ids = def.questions.map((q) => q.id);
  if (current === "inicio") return ids[0];
  if (current === "exposicion" && a.items.exposicion?.choice === DAYS_ZERO) return "elegibilidad";
  if (current === "elegibilidad") return a.eligibility === "no" ? "fuera" : "vinculo";
  let i = ids.indexOf(current) + 1;
  while (i < ids.length && skipReason(ids[i], a)) i++;
  return i < ids.length ? ids[i] : null;
}

/** Por qué se salta una pregunta (se guarda como omitida con motivo, no como "no"). */
export function skipReason(id: string, a: Answers): string | null {
  if (id === "frecuencia_fuera" && a.items.compra_fuera?.choice === "ninguno") return "sin_episodio_fuera";
  if (id === "alternativa" && a.items.prioridad?.choice === "ninguno") return "sin_problema_priorizado";
  return null;
}

export function isEligible(a: Answers): boolean {
  const days = a.items.exposicion?.choice;
  if (!days) return false;
  return days !== DAYS_ZERO || (!!a.eligibility && a.eligibility !== "no");
}

const EPISODES = ["episodio_descanso", "friccion_comida", "friccion_movilidad", "compra_fuera", "insatisfaccion"] as const;
const NONE = new Set(["ningun_problema", "0", "no", "ninguno", "ninguno_estoy_conforme"]);

/**
 * Útil = episodio concreto (o ausencia explícita de problema) + cómo se resolvió + frecuencia o costo.
 * Una respuesta satisfecha también es útil (contraevidencia).
 */
export function isUseful(a: Answers): boolean {
  if (!isEligible(a)) return false;
  const answered = EPISODES.filter((id) => a.items[id]?.choice);
  if (!answered.length) return false;
  const allNone = answered.every((id) => NONE.has(a.items[id]!.choice!));
  if (allNone) return answered.length >= 3;
  return answered.some((id) => {
    const x = a.items[id]!;
    if (NONE.has(x.choice!)) return false;
    const solved = (x.detail ?? "").trim().length >= 8;
    const cost = Object.values(x.money ?? {}).some((v) => typeof v === "number" && v >= 0);
    const freq = id === "friccion_comida" || (id === "compra_fuera" && !!a.items.frecuencia_fuera?.choice);
    return solved && (cost || freq || id === "friccion_movilidad");
  });
}

/** Segmentos (no excluyentes): S1 rotación, S2 técnico/supervisor, S3 residente/permanente, familia, visita. */
export function segmentsOf(a: Answers): string[] {
  const v = new Set(a.items.vinculo?.choices ?? []);
  const act = a.items.actividad?.choice;
  const out: string[] = [];
  if (v.has("trabajo_por_diagrama_rotacion") || a.eligibility === "diagrama_franco") out.push("S1");
  if (act === "tecnico" || act === "supervisor_ingeniero_mando_medio") out.push("S2");
  if (v.has("vivo_ahi") || v.has("trabajo_permanente_ahi")) out.push("S3");
  if (v.has("visito_a_familia_o_acompano_a_alguien_que_trabaja_ahi")) out.push("familia");
  if (v.has("visita_paso") || v.has("prestacion_ocasional")) out.push("visita");
  return out;
}

// --- datos personales en texto libre ------------------------------------------------------------

const PII: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/https?:\/\/\S+|www\.\S+/gi, "[enlace]"],
  [/\b\d{2}-?\d{8}-?\d\b/g, "[cuit]"],
  [/(?:\+?54\s?)?(?:9\s?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}\b/g, "[teléfono]"],
  [/\b\d{1,2}\.?\d{3}\.?\d{3}\b/g, "[documento]"],
  [/(^|[^\p{L}])([Mm]e llamo|[Ss]oy|[Mm]i nombre es|[Hh]ablé con|[Hh]able con|[Tt]rabajo (?:en|para|con))\s+(\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+){0,3})/gu, "$1$2 [nombre]"],
];

export function redact(text: string): { text: string; found: boolean } {
  let out = text;
  for (const [re, rep] of PII) out = out.replace(re, rep);
  return { text: out, found: out !== text };
}

export function redactAnswers(a: Answers): { answers: Answers; found: boolean } {
  let found = false;
  const items: Record<string, Answer> = {};
  for (const [k, v] of Object.entries(a.items)) {
    if (v.detail) {
      const r = redact(v.detail);
      found ||= r.found;
      items[k] = { ...v, detail: r.text };
    } else items[k] = v;
  }
  return { answers: { ...a, items }, found };
}

// --- atribución (URL de los anuncios) -----------------------------------------------------------

export type Attribution = { attribution: "meta" | "otro" | "desconocido"; variant: string | null; utm: Record<string, string>; meta: Record<string, string | boolean>; flags: string[] };

/**
 * Lee los parámetros de la landing. Una macro sin reemplazar ({{ad.id}} en vista previa) no se guarda:
 * queda marcada. Si no hay datos de origen, "desconocido": nunca se inventa un valor.
 */
export function parseAttribution(params: URLSearchParams, referrerHost: string | null, variants: string[]): Attribution {
  const flags: string[] = [];
  const clean = (k: string) => {
    const v = params.get(k)?.trim();
    if (!v) return null;
    if (/\{\{.*\}\}/.test(v)) {
      flags.push(`macro_sin_reemplazar:${k}`);
      return null;
    }
    return v.slice(0, 120);
  };
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = clean(k);
    if (v) utm[k] = v;
  }
  const meta: Record<string, string | boolean> = {};
  for (const [k, key] of [["cid", "campaign_id"], ["asid", "adset_id"], ["aid", "ad_id"], ["pl", "placement"], ["src", "site_source"]] as const) {
    const v = clean(k);
    if (v) meta[key] = v;
  }
  if (params.has("fbclid")) meta.fbclid_present = true;
  const v = clean("v")?.toUpperCase() ?? null;
  const variant = v && variants.includes(v) ? v : null;
  if (v && !variant) flags.push("variante_desconocida");
  const fromMeta = utm.utm_source?.toLowerCase() === "meta" || ["fb", "ig", "msg", "an"].includes(String(meta.site_source ?? "")) || !!meta.fbclid_present || /(^|\.)(facebook|instagram)\.com$/.test(referrerHost ?? "");
  const attribution = fromMeta ? "meta" : Object.keys(utm).length || referrerHost ? "otro" : "desconocido";
  return { attribution, variant, utm, meta, flags };
}
