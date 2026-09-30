import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { EmptyState, PageHeader, Pill, Section } from "@/components/app/bits";
import { createVoiceExperiment } from "./actions";

export const metadata: Metadata = { title: "Investigación" };

const STATUS: Record<string, string> = { borrador: "Borrador (no público)", piloto: "Piloto (solo con enlace)", activo: "Activo (público)", pausado: "Pausado", cerrado: "Cerrado" };

// Investigación: experimentos (Voice of Añelo) e hipótesis de diseño con sus preguntas y verticales.
// Recorrido: fuente/respuesta → evidencia → empresa/segmento → vertical → hipótesis → pregunta → decisión.
export default async function InvestigacionPage({ params }: PageProps<"/w/[slug]/investigacion">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [{ data: exps }, { data: hyps }, { data: qs }] = await Promise.all([
    supabase.from("research_experiments").select("id, title, status, slug"),
    supabase.from("findings").select("id, statement, dedup_key, review_status, maturity, verticals(code, name), question_findings(count), finding_evidence(stance), finding_companies(count)").like("dedup_key", "crm:%").order("dedup_key"),
    supabase.from("research_questions").select("kind"),
  ]);
  const qByKind = (qs ?? []).reduce<Record<string, number>>((a, q) => ((a[q.kind] = (a[q.kind] ?? 0) + 1), a), {});
  const base = `/w/${slug}`;
  return (
    <>
      <PageHeader title="Investigación" subtitle="Experimentos, hipótesis de diseño y preguntas de campo. Una respuesta o una noticia nunca promueven solas una oportunidad." />
      <div className="space-y-8">
        <Section title="Experimentos">
          {exps?.length ? (
            <ul className="divide-y rounded-xl border bg-card shadow-xs">
              {exps.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 p-4">
                  <Link href={`${base}/investigacion/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                  <Pill>{STATUS[e.status] ?? e.status}</Pill>
                  <span className="text-xs text-muted-foreground">/r/{e.slug}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Todavía no hay experimentos">
              {ctx.role === "owner" || ctx.role === "admin" ? (
                <ActionForm action={createVoiceExperiment.bind(null, slug)} className="mt-3 flex justify-center space-y-0"><SubmitButton variant="outline">Crear Voice of Añelo (borrador)</SubmitButton></ActionForm>
              ) : "Lo crea un owner o admin."}
            </EmptyState>
          )}
        </Section>

        <Section title={`Hipótesis de diseño migradas del CRM (${hyps?.length ?? 0})`}>
          <p className="text-xs text-muted-foreground">
            Entran pendientes de revisión: son diseño de investigación, no evidencia. Preguntas: {Object.entries(qByKind).map(([k, n]) => `${n} ${k}`).join(" · ") || "ninguna"}.
          </p>
          {hyps?.length ? (
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {hyps.map((h) => {
                const ev = h.finding_evidence ?? [];
                return (
                  <li key={h.id} className="space-y-1 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{h.dedup_key?.slice(4)}</span>
                      {h.verticals && <Pill>{h.verticals.code} · {h.verticals.name}</Pill>}
                      <Pill className={h.review_status === "aprobado" ? "border-primary/40 text-primary" : ""}>{h.review_status === "pendiente_revision" ? "pendiente de revisión" : h.review_status}</Pill>
                    </div>
                    <Link href={`${base}/hallazgos/${h.id}`} className="block hover:underline">{h.statement}</Link>
                    <p className="text-xs text-muted-foreground">
                      {h.question_findings?.[0]?.count ?? 0} preguntas · {h.finding_companies?.[0]?.count ?? 0} empresas del universo · evidencia: {ev.filter((x) => x.stance === "supports").length} a favor, {ev.filter((x) => x.stance === "contradicts").length} en contra
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState title="Todavía no se migraron las hipótesis del CRM" />}
        </Section>
      </div>
    </>
  );
}
