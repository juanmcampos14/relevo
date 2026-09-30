import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { VERTICALS } from "@/domain/verticals";
import { mapFindingsTab, mapResearch, type HypothesisPlan } from "@/domain/crm-import/research";
import { parseTab } from "./parse";

// Migración reejecutable de INVESTIGACIÓN | ENTREVISTAS y HALLAZGOS a RELEVO.
// - Verticales V01…V17 por código (crea las que faltan; nunca desde texto libre).
// - Hipótesis por su ID del Sheet (dedup_key crm:H-VA-01): se crean PENDIENTES DE REVISIÓN (el Sheet las marca
//   como propuesta); si ya existen no se pisa su enunciado (desde la migración se editan en RELEVO).
// - Preguntas por código (VO-Q01, H-VA-01-P, INV-hash) con sus vínculos a hipótesis.
// - Empresas del "universo existente" por su ID del CRM (AN-0001), si ya están importadas; si no, quedan
//   informadas como pendientes y se vinculan al reejecutar después de la importación del CRM.

type Db = SupabaseClient<Database>;
export const RESEARCH_GUIDE_URL = "https://drive.google.com/file/d/1IKHBUNyMHwgB6dC06b_YYu60dF341egS/view";

export type ResearchReport = {
  dryRun: boolean;
  verticals: { created: string[]; existing: number };
  hypotheses: { created: string[]; existing: string[] };
  questions: { created: number; existing: number; byKind: Record<string, number> };
  links: { questionHypothesis: number; hypothesisCompany: number; pendingCompanies: string[]; unknownHypotheses: string[] };
  skipped: { row: number; reason: string }[];
};

export async function migrateResearch(db: Db, workspaceId: string, buffer: ArrayBuffer, opts: { dryRun: boolean }): Promise<ResearchReport> {
  const plan = mapResearch(await parseTab(buffer, "INVESTIGACIÓN | ENTREVISTAS", "Pregunta de entrevista"));
  const hal = mapFindingsTab(await parseTab(buffer, "HALLAZGOS", "Hallazgo / señal"));
  const hypotheses: HypothesisPlan[] = [...plan.hypotheses, ...hal];
  const report: ResearchReport = {
    dryRun: opts.dryRun,
    verticals: { created: [], existing: 0 },
    hypotheses: { created: [], existing: [] },
    questions: { created: 0, existing: 0, byKind: {} },
    links: { questionHypothesis: 0, hypothesisCompany: 0, pendingCompanies: [], unknownHypotheses: [] },
    skipped: plan.skipped,
  };
  for (const q of plan.questions) report.questions.byKind[q.kind] = (report.questions.byKind[q.kind] ?? 0) + 1;

  // 1. Verticales por código.
  const { data: vs } = await db.from("verticals").select("id, code, name").eq("workspace_id", workspaceId);
  const vByCode = new Map((vs ?? []).filter((v) => v.code).map((v) => [v.code!, v.id]));
  for (const def of VERTICALS) {
    if (vByCode.has(def.code)) {
      report.verticals.existing++;
      continue;
    }
    report.verticals.created.push(`${def.code} ${def.name}`);
    if (opts.dryRun) continue;
    const sameName = (vs ?? []).find((v) => !v.code && v.name === def.name);
    if (sameName) {
      await db.from("verticals").update({ code: def.code, provisional: !!def.provisional }).eq("id", sameName.id);
      vByCode.set(def.code, sameName.id);
    } else {
      const { data, error } = await db.from("verticals").insert({ workspace_id: workspaceId, code: def.code, name: def.name, provisional: !!def.provisional }).select("id").single();
      if (error) throw error;
      vByCode.set(def.code, data.id);
    }
  }

  // 2. Fuente de la guía (procedencia de las hipótesis de diseño).
  let guideSource: string | null = null;
  const { data: guide } = await db.from("sources").select("id").eq("workspace_id", workspaceId).eq("url", RESEARCH_GUIDE_URL).maybeSingle();
  guideSource = guide?.id ?? null;
  if (!guideSource && !opts.dryRun) {
    const { data, error } = await db.from("sources").insert({ workspace_id: workspaceId, kind: "documento", title: "RELEVO · Discovery integrado AOG + Voice of Añelo V1 (diseño, 30/09/2026)", url: RESEARCH_GUIDE_URL, notes: "Diseño de investigación: propuestas, no evidencia de demanda. Migrado desde INVESTIGACIÓN | ENTREVISTAS del CRM." }).select("id").single();
    if (error) throw error;
    guideSource = data.id;
  }

  // 3. Hipótesis por su ID del Sheet.
  const { data: existing } = await db.from("findings").select("id, dedup_key").eq("workspace_id", workspaceId).in("dedup_key", hypotheses.map((h) => `crm:${h.code}`));
  const findingByCode = new Map((existing ?? []).map((f) => [f.dedup_key!.slice(4), f.id]));
  for (const h of hypotheses) {
    if (findingByCode.has(h.code)) {
      report.hypotheses.existing.push(h.code);
      continue;
    }
    report.hypotheses.created.push(h.code);
    if (opts.dryRun) {
      findingByCode.set(h.code, `nueva:${h.code}`);
      continue;
    }
    const { data, error } = await db
      .from("findings")
      .insert({
        workspace_id: workspaceId, source_id: guideSource!, kind: h.kind, statement: h.statement, analysis: h.analysis || null,
        evidence: h.sourceNote, origin: "manual", verification_status: h.verification, maturity: "hipotesis",
        vertical_id: h.vertical ? vByCode.get(h.vertical) ?? null : null, dedup_key: `crm:${h.code}`,
        review_note: `Migrada del CRM (${h.code}). Diseño de investigación: pendiente de revisión, no evidencia de demanda.`,
      })
      .select("id")
      .single();
    if (error) throw error;
    findingByCode.set(h.code, data.id);
  }

  // 4. Empresas del universo de cada hipótesis (por ID del CRM ya importado).
  const allRefs = [...new Set(hypotheses.flatMap((h) => h.companies))];
  const { data: refs } = allRefs.length
    ? await db.from("external_refs").select("external_id, entity_id").eq("workspace_id", workspaceId).eq("entity_type", "company").in("external_id", allRefs)
    : { data: [] };
  const companyByRef = new Map((refs ?? []).map((r) => [r.external_id.toUpperCase(), r.entity_id]));
  report.links.pendingCompanies = allRefs.filter((r) => !companyByRef.has(r)).sort();
  for (const h of hypotheses) {
    const fid = findingByCode.get(h.code);
    for (const ref of h.companies) {
      const cid = companyByRef.get(ref);
      if (!cid) continue;
      report.links.hypothesisCompany++;
      if (!opts.dryRun && fid) await db.from("finding_companies").upsert({ workspace_id: workspaceId, finding_id: fid, company_id: cid }, { onConflict: "finding_id,company_id", ignoreDuplicates: true });
    }
  }

  // 5. Preguntas por código y sus hipótesis.
  const { data: qs } = await db.from("research_questions").select("id, code").eq("workspace_id", workspaceId).in("code", plan.questions.map((q) => q.code));
  const questionByCode = new Map((qs ?? []).map((q) => [q.code, q.id]));
  for (const q of plan.questions) {
    let qid = questionByCode.get(q.code);
    if (qid) report.questions.existing++;
    else {
      report.questions.created++;
      if (!opts.dryRun) {
        const { data, error } = await db
          .from("research_questions")
          .insert({
            workspace_id: workspaceId, code: q.code, kind: q.kind, industry: q.industry, dimension: q.dimension, question: q.question,
            evidence_asked: q.evidenceAsked, hypothesis_text: q.hypothesisText, next_action: q.nextAction, owner_name: q.owner,
            source_url: q.sourceUrl, vertical_id: q.vertical ? vByCode.get(q.vertical) ?? null : null, origin: "crm",
          })
          .select("id")
          .single();
        if (error) throw error;
        qid = data.id;
      }
    }
    for (const code of q.hypotheses) {
      const fid = findingByCode.get(code);
      if (!fid) {
        if (!report.links.unknownHypotheses.includes(code)) report.links.unknownHypotheses.push(code);
        continue;
      }
      report.links.questionHypothesis++;
      if (!opts.dryRun && qid) await db.from("question_findings").upsert({ workspace_id: workspaceId, question_id: qid, finding_id: fid }, { onConflict: "question_id,finding_id", ignoreDuplicates: true });
    }
  }
  return report;
}
