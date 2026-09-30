import { describe, expect, it } from "vitest";
import { SURVEY_V1, isEligible, isUseful, nextStep, parseAttribution, redact, segmentsOf, type Answers } from "./survey";
import { funnel, num, parseMetaCsv, suppress } from "./metrics";

const a = (items: Answers["items"], extra: Partial<Answers> = {}): Answers => ({ items, ...extra });

describe("ramificaciones", () => {
  it("0 días → pantalla de vínculo habitual (no un confirm) → fuera de alcance si no hay vínculo", () => {
    const x = a({ exposicion: { choice: "0" } });
    expect(nextStep(SURVEY_V1, "exposicion", x)).toBe("elegibilidad");
    expect(nextStep(SURVEY_V1, "elegibilidad", { ...x, eligibility: "no" })).toBe("fuera");
    expect(nextStep(SURVEY_V1, "elegibilidad", { ...x, eligibility: "diagrama_franco" })).toBe("vinculo");
    expect(isEligible({ ...x, eligibility: "diagrama_franco" })).toBe(true);
    expect(isEligible({ ...x, eligibility: "no" })).toBe(false);
  });
  it("sin compra fuera se saltea la frecuencia; sin problema priorizado se saltea la alternativa", () => {
    expect(nextStep(SURVEY_V1, "compra_fuera", a({ compra_fuera: { choice: "ninguno" } }))).toBe("insatisfaccion");
    expect(nextStep(SURVEY_V1, "compra_fuera", a({ compra_fuera: { choice: "repuestos_mantenimiento" } }))).toBe("frecuencia_fuera");
    expect(nextStep(SURVEY_V1, "prioridad", a({ prioridad: { choice: "ninguno" } }))).toBe("abierta");
    expect(nextStep(SURVEY_V1, "abierta", a({}))).toBeNull();
  });
  it("el toque inicial no cambia las preguntas siguientes", () => {
    const base = a({ exposicion: { choice: "6_15" } });
    expect(nextStep(SURVEY_V1, "exposicion", { ...base, quick_tap: "comida" })).toBe(nextStep(SURVEY_V1, "exposicion", { ...base, quick_tap: "nada_en_particular" }));
  });
});

describe("elegible, útil y segmentos", () => {
  it("la respuesta satisfecha es útil (contraevidencia) y el episodio necesita solución + costo o frecuencia", () => {
    const conforme = a({ exposicion: { choice: "16_30" }, episodio_descanso: { choice: "ningun_problema" }, friccion_comida: { choice: "0" }, friccion_movilidad: { choice: "no" } });
    expect(isUseful(conforme)).toBe(true);
    const vago = a({ exposicion: { choice: "6_15" }, friccion_comida: { choice: "2_3" } });
    expect(isUseful(vago)).toBe(false);
    const episodio = a({ exposicion: { choice: "6_15" }, friccion_comida: { choice: "2_3", detail: "Salí del turno a las 23 y no había nada abierto" } });
    expect(isUseful(episodio)).toBe(true);
  });
  it("segmentos no excluyentes, incluidos familiares y visitas", () => {
    expect(segmentsOf(a({ vinculo: { choices: ["trabajo_por_diagrama_rotacion", "visito_a_familia_o_acompano_a_alguien_que_trabaja_ahi"] }, actividad: { choice: "supervisor_ingeniero_mando_medio" } }))).toEqual(["S1", "S2", "familia"]);
  });
});

describe("datos personales", () => {
  it("redacta email, teléfono, documento y nombres presentados", () => {
    const r = redact("Soy Juan Pérez, escribime a juan@x.com o al 299 154 123456. DNI 30.123.456. Hablé con María en el hotel.");
    expect(r.found).toBe(true);
    expect(r.text).not.toMatch(/Juan|Pérez|juan@x|30\.123|María/);
    expect(redact("Salí del turno a las 23 y no había nada").found).toBe(false);
  });
});

describe("atribución", () => {
  it("Meta con macros reemplazadas; macro sin reemplazar no se guarda; sin datos = desconocido", () => {
    const p = new URLSearchParams("utm_source=meta&utm_campaign=120200&cid=120200&aid=120211&pl=Instagram_Stories&src=ig&v=b&fbclid=xyz");
    expect(parseAttribution(p, null, ["A", "B"])).toMatchObject({ attribution: "meta", variant: "B", meta: { campaign_id: "120200", ad_id: "120211", placement: "Instagram_Stories", site_source: "ig", fbclid_present: true } });
    const preview = parseAttribution(new URLSearchParams("utm_source=meta&aid={{ad.id}}&v=A"), null, ["A", "B"]);
    expect(preview.meta.ad_id).toBeUndefined();
    expect(preview.flags).toContain("macro_sin_reemplazar:aid");
    expect(parseAttribution(new URLSearchParams(""), null, ["A"]).attribution).toBe("desconocido");
  });
});

describe("embudo y supresión", () => {
  it("cada etapa con su denominador, por variante", () => {
    const f = funnel({
      sessions: [{ id: "1", variant: "A", started: true, outcome: "completa" }, { id: "2", variant: "A", started: false, outcome: null }, { id: "3", variant: "B", started: true, outcome: "fuera_de_alcance" }],
      responses: [{ session_id: "1", eligible: true, useful: false }],
    }, "A");
    expect(f.map((s) => [s.key, s.n, s.of])).toEqual([["visitas", 2, null], ["inicios", 1, 2], ["completas", 1, 1], ["elegibles", 1, 1], ["utiles", 0, 1]]);
  });
  it("oculta celdas < 5 y una complementaria para que no se deduzca por resta", () => {
    expect(suppress([{ key: "a", n: 12 }, { key: "b", n: 7 }, { key: "c", n: 3 }])).toEqual([{ key: "a", n: 12 }, { key: "b", n: null }, { key: "c", n: null }]);
    expect(suppress([{ key: "a", n: 2 }, { key: "b", n: 1 }]).every((c) => c.n === null)).toBe(true);
  });
});

describe("CSV de Meta", () => {
  const csv = [
    '"Reporting starts","Reporting ends","Day","Campaign ID","Ad set ID","Ad ID","Ad name","Amount spent (USD)","Impressions","Reach","Link clicks","Landing page views"',
    '2026-10-06,2026-10-06,2026-10-06,120200,120201,120211,"A · experiencia",7.52,1450,1100,41,33',
    '2026-10-06,2026-10-06,2026-10-06,120200,120201,120212,"B · tiempo",7.48,1390,1050,52,40',
    '2026-10-06,2026-10-07,,120200,120201,120212,"B · tiempo",15.00,2000,1500,60,50',
    ',,,,,,Total,15.00,2840,,93,73',
  ].join("\n");
  it("lee filas diarias, rechaza las que no tienen día y detecta moneda y período", () => {
    const r = parseMetaCsv(csv);
    expect(r.currency).toBe("USD");
    expect(r.rows.map((x) => [x.day, x.ad_id, x.spend, x.landing_page_views])).toEqual([["2026-10-06", "120211", 7.52, 33], ["2026-10-06", "120212", 7.48, 40]]);
    expect(r.rejected.map((x) => x.line)).toEqual([4, 5]);
    expect([r.periodStart, r.periodEnd]).toEqual(["2026-10-06", "2026-10-06"]);
  });
  it("encabezados en castellano, separador ; y decimales con coma", () => {
    const r = parseMetaCsv('Día;Identificador del anuncio;Importe gastado (ARS);Impresiones\n06/10/2026;120211;"12.345,60";1000');
    expect(r.rows[0]).toMatchObject({ day: "2026-10-06", spend: 12345.6, currency: "ARS", impressions: 1000 });
    expect(num("1,234.50")).toBe(1234.5);
  });
});
