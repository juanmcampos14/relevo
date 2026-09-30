import type { Dimension, Gap, Metrics } from "./readiness";
import type { EconomicFact } from "./economics";

// Caso en estudio: la misma hipótesis vista como posible negocio. Sin puntaje: etapa + criterios explicables.
//   señal → en validación → caso en estudio → oportunidad → decisión

export type CaseStage = "idea" | "senal" | "en_validacion" | "caso" | "oportunidad";
export const STAGE_LABEL: Record<CaseStage, string> = {
  idea: "Idea",
  senal: "Señal",
  en_validacion: "En validación",
  caso: "Caso en estudio",
  oportunidad: "Oportunidad",
};

export function caseStage(f: { maturity: string; independentCases: number; hasOpportunity: boolean }): CaseStage {
  if (f.hasOpportunity) return "oportunidad";
  if (f.maturity === "caso") return "caso";
  if (f.maturity === "idea") return "idea";
  if (f.maturity === "finding" || f.independentCases >= 2) return "en_validacion";
  return "senal";
}

export type Criterion = { key: string; label: string; ok: boolean; detail: string };

const known = (dims: Dimension[], ...keys: string[]) => dims.find((d) => keys.includes(d.key) && d.status === "sabido");

/**
 * Qué le falta a un caso para presentarse como oportunidad (docs/04 §16): problema concreto, evidencia
 * suficiente, actor afectado, comprador o decisor identificable, economía y un próximo hito verificable.
 * No decide: muestra qué está y qué no.
 */
export function opportunityCriteria(input: {
  dims: Dimension[];
  gaps: Gap[];
  metrics: Pick<Metrics, "independentCases" | "contradicts">;
  economics: EconomicFact[];
  nextMilestone: string | null;
  /** Fuentes directas o documentales fuertes a favor (observado en campo, o documentado y verificado). */
  strongSources?: number;
}): { met: boolean; items: Criterion[] } {
  const { dims, gaps, metrics, economics } = input;
  const problem = known(dims, "problema");
  const actor = known(dims, "actor_afectado", "usuario");
  const buyer = known(dims, "comprador", "decisor");
  const econ = economics.filter((e) => e.basis !== "estimado" && ["precio", "frecuencia", "volumen", "usuarios", "margen", "opex", "capex"].includes(e.variable));
  const disputed = gaps.includes("contradiccion_sin_resolver");
  const items: Criterion[] = [
    { key: "problema", label: "Problema concreto", ok: !!problem, detail: problem?.summary ?? "Todavía no está respaldado por evidencia." },
    {
      // Suficiente = una fuente directa o documental fuerte, o más de una fuente independiente consistente; sin contradicción abierta.
      key: "evidencia",
      label: "Evidencia suficiente",
      ok: (metrics.independentCases >= 2 || (input.strongSources ?? 0) >= 1) && !disputed,
      detail: `${metrics.independentCases} ${metrics.independentCases === 1 ? "caso independiente" : "casos independientes"}${input.strongSources ? ` · ${input.strongSources} ${input.strongSources === 1 ? "fuente directa o documental fuerte" : "fuentes directas o documentales fuertes"}` : ""}${metrics.contradicts ? ` · ${metrics.contradicts} en contra${disputed ? " sin resolver" : ""}` : ""}.`,
    },
    { key: "actor", label: "Actor afectado", ok: !!actor, detail: actor?.summary ?? "No sabemos bien quién lo sufre." },
    { key: "comprador", label: "Comprador o decisor identificable", ok: !!buyer, detail: buyer?.summary ?? "No sabemos quién paga ni quién decide." },
    { key: "economia", label: "Economía o mecanismo de valor", ok: econ.length > 0, detail: econ.length ? econ.map((e) => e.value).join(" · ") : "Sin datos económicos que no sean estimaciones." },
    { key: "hito", label: "Próximo hito verificable", ok: !!input.nextMilestone, detail: input.nextMilestone ?? "No hay una validación agendada o propuesta." },
  ];
  return { met: items.every((i) => i.ok), items };
}
