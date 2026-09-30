// INVESTIGACIÓN | ENTREVISTAS (y HALLAZGOS) del CRM → hipótesis y preguntas de RELEVO. Mapeo PURO.
// Conserva los IDs del Sheet (H-VA-xx, VO-Qxx, HAL-xxx). Las filas sin ID (preguntas generales, reglas)
// reciben un código derivado de su contenido: reejecutar no duplica mientras el texto no cambie.
import { createHash } from "node:crypto";
import { verticalByLabel } from "@/domain/verticals";

export type ResearchRow = { row: number; values: Record<string, string | null> };

export type HypothesisPlan = {
  code: string;
  vertical: string | null;
  verticalLabel: string | null;
  statement: string;
  question: string | null;
  evidenceAsked: string | null;
  analysis: string;
  companies: string[];
  sourceNote: string | null;
  owner: string | null;
  kind: "necesidad" | "senal_de_mercado";
  verification: string;
};
export type QuestionPlan = {
  code: string;
  kind: "entrevista" | "voice" | "regla" | "control";
  industry: string | null;
  dimension: string | null;
  question: string;
  evidenceAsked: string | null;
  hypothesisText: string | null;
  nextAction: string | null;
  owner: string | null;
  sourceUrl: string | null;
  vertical: string | null;
  hypotheses: string[];
};
export type ResearchPlan = { hypotheses: HypothesisPlan[]; questions: QuestionPlan[]; skipped: { row: number; reason: string }[] };

const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

/** "VO-Q08 · H-VA-04/10/11" → ["H-VA-04","H-VA-10","H-VA-11"]. */
export function hypothesisRefs(text: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/H-VA-(\d{2})((?:\/\d{2})*)/g)) {
    out.push(`H-VA-${m[1]}`);
    for (const extra of m[2].split("/").filter(Boolean)) out.push(`H-VA-${extra}`);
  }
  return [...new Set(out)];
}

/** "Empresas: AN-0001 / AN-0002" → ["AN-0001","AN-0002"]. */
export const companyRefs = (text: string | null) => [...new Set([...(text ?? "").matchAll(/\bAN-\d{4}\b/g)].map((m) => m[0]))];

export function mapResearch(rows: ResearchRow[]): ResearchPlan {
  const plan: ResearchPlan = { hypotheses: [], questions: [], skipped: [] };
  for (const { row, values: v } of rows) {
    const industry = t(v["Industria"]);
    const dimension = t(v["Dimensión"]);
    const question = t(v["Pregunta de entrevista"]);
    const evidence = t(v["Qué evidencia pedir"]);
    const problem = t(v["Problema / hipótesis"]);
    const source = t(v["Fuente / fecha"]);
    const next = t(v["Próxima acción"]);
    const owner = t(v["Responsable"]);
    if (!question) {
      if (industry || dimension) plan.skipped.push({ row, reason: "sin pregunta" });
      continue;
    }
    const hv = dimension?.match(/^(H-VA-\d{2})\b/)?.[1];
    const vo = dimension?.match(/^(VO-Q\d{2})\b/)?.[1];
    const vertical = verticalByLabel(industry);
    if (hv) {
      plan.hypotheses.push({
        code: hv,
        vertical: vertical?.code ?? null,
        verticalLabel: industry,
        statement: (problem ?? "").replace(/^HIP[ÓO]TESIS\s*·\s*/i, "").trim() || question,
        question,
        evidenceAsked: evidence,
        analysis: [evidence ? `Qué descubrir / evidencia: ${evidence}` : null, next].filter(Boolean).join("\n"),
        companies: companyRefs(next),
        sourceNote: source,
        owner,
        kind: "necesidad",
        verification: "unverified",
      });
      plan.questions.push({ code: `${hv}-P`, kind: "entrevista", industry, dimension, question, evidenceAsked: evidence, hypothesisText: problem, nextAction: next, owner, sourceUrl: null, vertical: vertical?.code ?? null, hypotheses: [hv] });
      continue;
    }
    const kind: QuestionPlan["kind"] = vo ? "voice" : /^regla relevo/i.test(dimension ?? "") ? "regla" : /control de dise/i.test(industry ?? "") ? "control" : "entrevista";
    const url = [next, source, evidence].map((x) => x?.match(/https?:\/\/\S+/)?.[0] ?? null).find(Boolean) ?? null;
    plan.questions.push({
      code: vo ?? `INV-${shortHash(norm(`${industry}|${dimension}|${question}`))}`,
      kind,
      industry,
      dimension,
      question,
      evidenceAsked: evidence,
      hypothesisText: problem,
      nextAction: next,
      owner,
      sourceUrl: url ? url.replace(/[).,;]+$/, "") : null,
      vertical: vertical?.code ?? null,
      hypotheses: hypothesisRefs(dimension),
    });
  }
  return plan;
}

/** HALLAZGOS del CRM (HAL-xxx) → hipótesis registradas por el equipo (no evidencia validada). */
export function mapFindingsTab(rows: ResearchRow[]): HypothesisPlan[] {
  const out: HypothesisPlan[] = [];
  for (const { values: v } of rows) {
    const code = t(v["ID"]);
    const statement = t(v["Hallazgo / señal"]);
    if (!code || !/^HAL-\d+/.test(code) || !statement) continue;
    const vertical = verticalByLabel(t(v["Vertical"])) ?? (/(activos|inmobiliari)/i.test(v["Vertical"] ?? "") ? verticalByLabel("Inmuebles, activos y fondos de comercio") : null);
    const parts: [string, string | null][] = [
      ["Tipo", t(v["Tipo"])], ["Empresa / lugar", t(v["Empresa / lugar"])], ["Evidencia", t(v["Evidencia"])], ["Frecuencia", t(v["Frecuencia"])],
      ["Impacto", t(v["Impacto"])], ["Contraevidencia", t(v["Contraevidencia"])], ["Economía / impacto", t(v["Economía / impacto"])],
      ["Segundo caso", t(v["Segundo caso"])], ["Usuario afectado", t(v["Usuario afectado"])], ["Comprador / pagador", t(v["Comprador / pagador"])],
      ["Fuente IDs", t(v["Fuente IDs"])], ["Qué falta saber", t(v["Qué falta saber"])], ["Próxima acción", t(v["Próxima acción"])], ["Estado", t(v["Estado"])],
    ];
    out.push({
      code,
      vertical: vertical?.code ?? null,
      verticalLabel: t(v["Vertical"]),
      statement,
      question: null,
      evidenceAsked: null,
      analysis: parts.filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`).join("\n"),
      companies: companyRefs(`${v["Empresa / lugar"] ?? ""} ${v["Fuente IDs"] ?? ""}`),
      sourceNote: t(v["Fuente IDs"]),
      owner: t(v["Responsable"]),
      kind: "senal_de_mercado",
      verification: ["partially_verified", "publicly_verified", "field_verified", "unverified"].includes(t(v["Estado evidencia"]) ?? "") ? t(v["Estado evidencia"])! : "unverified",
    });
  }
  return out;
}
