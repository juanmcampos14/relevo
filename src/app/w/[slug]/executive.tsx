import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GAPS, type Dimension, type Gap } from "@/domain/readiness";
import { BASIS_LABEL, ECONOMICS, type EconomicFact } from "@/domain/economics";
import { STAGE_LABEL, caseStage, opportunityCriteria } from "@/domain/case";
import { Pill, Section, formatDate } from "@/components/app/bits";

// Vista Ejecutiva: qué aprendimos, qué cambió y qué negocio puede derivarse. Mismos datos que la
// operativa, otra lectura. Sin conteos de actividad: conocimiento, evidencia, incertidumbre y decisiones.

type Db = SupabaseClient<Database>;
const RANK: Record<string, number> = { caso: 0, finding: 1, hipotesis: 2, idea: 3 };
const MATURITY: Record<string, string> = { idea: "Idea", hipotesis: "Hipótesis", finding: "Finding", caso: "Caso en estudio" };
const REL: Record<string, string> = { acota: "se acotó", amplia: "se amplió", segmenta: "se segmentó" };

function Card({ children }: { children: ReactNode }) {
  return <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">{children}</div>;
}
const q = (s: string, n = 90) => `«${s.length > n ? `${s.slice(0, n)}…` : s}»`;

/** since: desde cuándo mirar "qué cambió" (dos semanas, calculado por la página). */
export async function ExecutiveView({ supabase, slug, userId, canApprove, since }: { supabase: Db; slug: string; userId: string; canApprove: boolean; since: string }) {
  const base = `/w/${slug}`;
  const [{ data: findings }, { data: assessments }, { data: revisions }, { data: contra }, { data: opps }, { data: decisions }, { data: help }, { data: milestones }, { data: proposed }] = await Promise.all([
    supabase.from("findings").select("id, statement, maturity, created_at, updated_at, companies(trade_name, legal_name), opportunity_findings(opportunities(id, status))").eq("review_status", "aprobado").limit(200),
    supabase.from("finding_assessments").select("finding_id, created_at, summary, gaps, dimensions, economics, independent_cases, contradicts").order("created_at", { ascending: false }).limit(400),
    supabase.from("finding_revisions").select("finding_id, kind, relation, previous_value, new_value, created_at, capture_id").gte("created_at", since).order("created_at", { ascending: false }).limit(20),
    supabase.from("finding_evidence").select("finding_id, created_at, evidence(statement, capture_id)").eq("stance", "contradicts").gte("created_at", since).order("created_at", { ascending: false }).limit(20),
    supabase.from("opportunities").select("id, title, status, stage, next_action").neq("status", "rechazada").order("updated_at", { ascending: false }).limit(10),
    supabase.from("decisions").select("id, question, due_on, opportunity_id").eq("status", "requested").order("due_on", { nullsFirst: false }).limit(5),
    supabase.from("tasks").select("id, title, assignee_id, finding_id, due_on").eq("kind", "Ayuda").neq("status", "done").order("created_at", { ascending: false }).limit(10),
    supabase.from("tasks").select("finding_id, title").not("finding_id", "is", null).neq("status", "done").neq("kind", "Ayuda"),
    supabase.from("proposals").select("finding_id, payload").eq("status", "propuesta").not("finding_id", "is", null).order("position"),
  ]);
  // Próximo hito: una validación agendada o, si no, la primera propuesta.
  const milestoneOf = (id: string) =>
    (milestones ?? []).find((t) => t.finding_id === id)?.title ?? ((proposed ?? []).find((p) => p.finding_id === id)?.payload as { title?: string } | undefined)?.title ?? null;
  const latest = new Map<string, NonNullable<typeof assessments>[number]>();
  for (const a of assessments ?? []) if (!latest.has(a.finding_id)) latest.set(a.finding_id, a);
  const rows = (findings ?? []).map((f) => {
    const a = latest.get(f.id);
    const dims = (a?.dimensions ?? []) as unknown as Dimension[];
    const gaps = (a?.gaps ?? []) as Gap[];
    const economics = (a?.economics ?? []) as unknown as EconomicFact[];
    const cases = a?.independent_cases ?? 0;
    const hasOpp = f.opportunity_findings.some((o) => o.opportunities && o.opportunities.status !== "rechazada");
    return {
      ...f, a, dims, gaps, economics, cases, contradicts: a?.contradicts ?? 0,
      stage: caseStage({ maturity: f.maturity, independentCases: cases, hasOpportunity: hasOpp }),
      criteria: opportunityCriteria({ dims, gaps, metrics: { independentCases: cases, contradicts: a?.contradicts ?? 0 }, economics, nextMilestone: milestoneOf(f.id) }),
      updated: a?.created_at ?? f.updated_at,
    };
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Qué sabemos: lo más maduro y mejor sostenido primero.
  const known = rows.filter((r) => r.maturity !== "idea" && r.a).sort((x, y) => RANK[x.maturity] - RANK[y.maturity] || y.cases - x.cases).slice(0, 5);
  // Dónde podría haber negocio: casos y validaciones en curso (sin inflarlos a oportunidad).
  const business = rows.filter((r) => r.stage === "caso" || r.stage === "en_validacion").sort((x, y) => RANK[x.maturity] - RANK[y.maturity] || y.cases - x.cases).slice(0, 5);
  const econ = rows.filter((r) => r.economics.length).slice(0, 6);
  // Qué cambió nuestra lectura: reformulaciones y contraevidencia reciente.
  const changes = [
    ...(revisions ?? []).filter((r) => r.kind === "enunciado").map((r) => ({ at: r.created_at, findingId: r.finding_id, before: r.previous_value, after: r.new_value, what: `La hipótesis ${REL[r.relation ?? ""] ?? "se reformuló"} con evidencia nueva.`, capture: r.capture_id })),
    ...(contra ?? []).filter((c) => byId.has(c.finding_id)).map((c) => ({ at: c.created_at, findingId: c.finding_id, before: byId.get(c.finding_id)!.statement, after: null as string | null, what: `Evidencia en contra: ${q(c.evidence?.statement ?? "", 110)}`, capture: c.evidence?.capture_id ?? null })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  // Qué todavía no sabemos: faltantes que frenan casos y validaciones.
  const gapCount = new Map<Gap, string[]>();
  for (const r of business.length ? business : known) for (const g of r.gaps) gapCount.set(g, [...(gapCount.get(g) ?? []), r.statement]);
  const unknowns = [...gapCount].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  // Dónde puede ayudar alguien del equipo: acceso a quien compra o decide.
  const needAccess = business.filter((r) => r.gaps.includes("falta_comprador")).slice(0, 3);
  const opportunities = (opps ?? []);

  const votes = canApprove ? (decisions ?? []) : [];
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {votes.length > 0 && (
        <Section title="Esperan tu decisión" className="lg:col-span-2">
          <ul className="space-y-2">
            {votes.map((d) => (
              <li key={d.id}>
                <Link href={d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`} className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-primary/40 bg-card px-4 py-3 text-sm font-medium shadow-xs hover:bg-muted/40">
                  <span>{d.question}{d.due_on ? <span className="font-normal text-muted-foreground"> · vence {formatDate(d.due_on)}</span> : null}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Qué sabemos" className="lg:col-span-2">
        {known.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {known.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/hallazgos/${r.id}`} className="block h-full space-y-2 rounded-xl border bg-card p-4 shadow-xs hover:bg-muted/40">
                  <p className="font-medium">{r.statement}</p>
                  {r.a?.summary && <p className="text-sm text-muted-foreground">{r.a.summary}</p>}
                  <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Pill>{MATURITY[r.maturity]}</Pill>
                    <span>{r.cases} {r.cases === 1 ? "fuente independiente" : "fuentes independientes"}</span>
                    {r.contradicts > 0 && <span className="text-destructive">· {r.contradicts} en contra</span>}
                    <span>· actualizado {formatDate(r.updated)}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Card><p className="text-sm text-muted-foreground">Todavía no hay aprendizajes sostenidos por evidencia. Cero también es un resultado válido: aparecen a medida que la evidencia de campo los respalda.</p></Card>
        )}
      </Section>

      <Section title="Dónde podría haber negocio">
        <Card>
          {business.length ? (
            <ul className="space-y-3">
              {business.map((r) => {
                const missing = r.criteria.items.filter((i) => !i.ok).map((i) => i.label.toLowerCase());
                return (
                  <li key={r.id} className="space-y-1">
                    <Link href={`${base}/hallazgos/${r.id}`} className="font-medium hover:underline">{r.statement}</Link>
                    <p className="text-xs text-muted-foreground">
                      <Pill className="mr-1">{STAGE_LABEL[r.stage]}</Pill>
                      {r.criteria.met ? "Cumple los criterios para evaluarse como oportunidad." : `Para ser oportunidad falta: ${missing.join(", ")}.`}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin casos en validación todavía. No se inflan señales a oportunidades.</p>
          )}
          {opportunities.length > 0 && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Oportunidades (promovidas por el equipo)</p>
              {opportunities.map((o) => (
                <Link key={o.id} href={`${base}/oportunidades/o/${o.id}`} className="flex items-center justify-between gap-2 text-sm hover:underline">
                  <span>{o.title}</span>
                  <span className="text-xs text-muted-foreground">{o.status === "candidata" ? "candidata" : o.stage?.replace(/_/g, " ")}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Economía descubierta">
        <Card>
          {econ.length ? (
            <ul className="space-y-3">
              {econ.map((r) => (
                <li key={r.id} className="space-y-1">
                  <Link href={`${base}/hallazgos/${r.id}`} className="text-sm font-medium hover:underline">{q(r.statement, 80)}</Link>
                  <ul className="space-y-0.5 text-sm">
                    {r.economics.map((e) => (
                      <li key={e.variable} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-muted-foreground">{ECONOMICS[e.variable]}:</span>
                        <span>{e.value}</span>
                        <span className={`text-xs ${e.basis === "estimado" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>({BASIS_LABEL[e.basis]}{e.formula ? `: ${e.formula}` : ""})</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no hay datos económicos (precio, frecuencia, volumen, pagador…). Todo lo demás es desconocido.</p>
          )}
        </Card>
      </Section>

      <Section title="Qué cambió nuestra lectura">
        <Card>
          {changes.length ? (
            <ul className="space-y-3">
              {changes.map((c, i) => {
                const r = byId.get(c.findingId);
                return (
                  <li key={i} className="space-y-1 text-sm">
                    <p><span className="text-xs font-medium text-muted-foreground">Antes: </span>{q(c.before, 110)}</p>
                    <p><span className="text-xs font-medium text-muted-foreground">Nueva evidencia: </span>{c.what}{c.capture && <> <Link href={`${base}/capturas/${c.capture}`} className="text-primary hover:underline">ver captura</Link></>}</p>
                    {c.after && <p><span className="text-xs font-medium text-muted-foreground">Ahora: </span>{q(c.after, 110)}</p>}
                    {r?.a?.summary && <p><span className="text-xs font-medium text-muted-foreground">Implicación: </span>{r.a.summary}</p>}
                    <p className="text-xs text-muted-foreground">{formatDate(c.at)} · <Link href={`${base}/hallazgos/${c.findingId}`} className="text-primary hover:underline">ver hipótesis</Link></p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin cambios de lectura en las últimas dos semanas.</p>
          )}
        </Card>
      </Section>

      <Section title="Qué todavía no sabemos">
        <Card>
          {unknowns.length ? (
            <ul className="space-y-2 text-sm">
              {unknowns.map(([g, stmts]) => (
                <li key={g}>
                  <span className="font-medium">{GAPS[g]?.label ?? g}</span>
                  <span className="text-muted-foreground"> · frena {stmts.length === 1 ? q(stmts[0], 70) : `${stmts.length} hipótesis`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Sin faltantes críticos registrados.</p>
          )}
        </Card>
      </Section>

      <Section title="Decisiones y ayuda requerida" className="lg:col-span-2">
        <Card>
          {!votes.length && (decisions ?? []).length > 0 && (
            <ul className="space-y-1">
              {(decisions ?? []).map((d) => (
                <li key={d.id}>
                  <Link href={d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`} className="flex items-center justify-between gap-2 text-sm hover:underline">
                    <span><span className="font-medium">Decisión{canApprove ? " (tu voto)" : ""}:</span> {d.question}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {(help ?? []).length > 0 && (
            <ul className="space-y-1">
              {(help ?? []).map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="font-medium">{h.assignee_id === userId ? "Te piden ayuda" : "Pedido de ayuda"}:</span> {h.title}
                  {h.finding_id && <> · <Link href={`${base}/hallazgos/${h.finding_id}`} className="text-primary hover:underline">caso</Link></>}
                </li>
              ))}
            </ul>
          )}
          {needAccess.length > 0 && (
            <ul className="space-y-1">
              {needAccess.map((r) => (
                <li key={r.id} className="text-sm">
                  <span className="font-medium">Acceso a quien compra o decide</span> para {q(r.statement, 80)}: ¿alguien del equipo tiene un contacto o una introducción?{" "}
                  <Link href={`${base}/hallazgos/${r.id}`} className="text-primary hover:underline">ver caso</Link>
                </li>
              ))}
            </ul>
          )}
          {!(decisions ?? []).length && !(help ?? []).length && !needAccess.length && <p className="text-sm text-muted-foreground">No hay decisiones ni pedidos de ayuda abiertos.</p>}
        </Card>
      </Section>
    </div>
  );
}
