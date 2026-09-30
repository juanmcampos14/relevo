import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { PAYERS, redactAnswers, segmentsOf, type Answers, type SurveyDefinition } from "@/domain/voice/survey";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { EmptyState, PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { deleteByCode, responseToEvidence, reviewResponse } from "../../actions";

export const metadata: Metadata = { title: "Respuestas" };

// Revisión de respuestas (owner/admin). En pantalla siempre la versión redactada; revisar la vuelve
// definitiva. Una respuesta es una DECLARACIÓN; pasa a evidencia solo si una persona lo decide.
export default async function ResponsesPage({ params, searchParams }: PageProps<"/w/[slug]/investigacion/[id]/respuestas">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  if (ctx.role !== "owner" && ctx.role !== "admin") notFound();
  const supabase = await createClient();
  const cohort = sp.cohorte === "piloto" || sp.cohorte === "prueba" ? sp.cohorte : "real";
  const estado = sp.estado === "revisada" || sp.estado === "descartada" ? sp.estado : "pendiente";
  const [{ data: version }, { data: rows }, { data: hyps }] = await Promise.all([
    supabase.from("survey_versions").select("definition").eq("experiment_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("survey_responses").select("id, created_at, cohort, answers, eligible, useful, pii_detected, duplicate_of, review_status, review_note, deletion_code, survey_sessions(variant_code, attribution, quick_tap, quick_tap_shown)").eq("experiment_id", id).eq("cohort", cohort).eq("review_status", estado).order("created_at", { ascending: false }).limit(100),
    supabase.from("findings").select("id, dedup_key, statement").like("dedup_key", "crm:H-VA-%").order("dedup_key"),
  ]);
  if (!version) notFound();
  const def = version.definition as unknown as SurveyDefinition;
  const label = (qid: string, v: string | null | undefined) => def.questions.find((q) => q.id === qid)?.options.find((o) => o.value === v)?.label ?? v ?? "—";
  const base = `/w/${slug}/investigacion/${id}/respuestas`;
  return (
    <>
      <PageHeader title="Respuestas" subtitle="Declaraciones autoseleccionadas. Revisar redacta el texto libre de forma definitiva." back={<Link href={`/w/${slug}/investigacion/${id}`}>← Experimento</Link>} />
      <div className="space-y-6">
        <p className="flex flex-wrap gap-3 text-sm">
          {(["real", "piloto", "prueba"] as const).map((c) => <Link key={c} href={`${base}?cohorte=${c}&estado=${estado}`} className={c === cohort ? "font-semibold text-primary" : "text-muted-foreground"}>{c}</Link>)}
          <span className="text-muted-foreground">·</span>
          {(["pendiente", "revisada", "descartada"] as const).map((s) => <Link key={s} href={`${base}?cohorte=${cohort}&estado=${s}`} className={s === estado ? "font-semibold text-primary" : "text-muted-foreground"}>{s}</Link>)}
        </p>
        {rows?.length ? (
          <ul className="space-y-4">
            {rows.map((r) => {
              const a = redactAnswers(r.answers as unknown as Answers).answers;
              const s = r.survey_sessions as unknown as { variant_code: string | null; attribution: string; quick_tap: string | null; quick_tap_shown: boolean } | null;
              return (
                <li key={r.id} className="space-y-3 rounded-xl border bg-card p-4 text-sm shadow-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{r.deletion_code}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(r.created_at, true)}</span>
                    <Pill>{r.eligible ? "elegible" : "no elegible"}</Pill>
                    <Pill className={r.useful ? "border-primary/40 text-primary" : ""}>{r.useful ? "útil" : "sin episodio útil"}</Pill>
                    {r.pii_detected && <Pill className="border-amber-500/50 text-amber-700 dark:text-amber-300">datos personales detectados</Pill>}
                    {r.duplicate_of && <Pill className="border-destructive/50 text-destructive">posible duplicado</Pill>}
                    <span className="text-xs text-muted-foreground">variante {s?.variant_code ?? "—"} · {s?.attribution} · segmentos {segmentsOf(a).join(", ") || "—"}{s?.quick_tap_shown ? ` · toque: ${s.quick_tap ?? "—"}` : ""}</span>
                  </div>
                  <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[14rem_1fr]">
                    {def.questions.map((q) => {
                      const x = a.items[q.id];
                      if (!x) return null;
                      const money = Object.entries(x.money ?? {}).filter(([, v]) => v !== null).map(([k, v]) => `${q.money?.find((m) => m.key === k)?.kind === "hipotetico" ? "hipotético" : "observado"} ARS ${v}`);
                      return (
                        <div key={q.id} className="contents">
                          <dt className="text-muted-foreground">{q.code} · {q.id}</dt>
                          <dd>{x.omitted ? <i className="text-muted-foreground">omitida{x.skipped ? ` (${x.skipped})` : ""}</i> : [(x.choices ?? (x.choice ? [x.choice] : [])).map((c) => label(q.id, c)).join(", "), x.payer ? `pagó: ${PAYERS.find((p) => p.value === x.payer)?.label ?? x.payer}` : null, ...money, x.detail ? `«${x.detail}»` : null].filter(Boolean).join(" · ")}</dd>
                        </div>
                      );
                    })}
                  </dl>
                  {r.review_status === "pendiente" && (
                    <ActionForm action={reviewResponse.bind(null, slug, r.id)} className="flex flex-wrap items-end gap-2 space-y-0">
                      <TextField name="note" label="Nota de revisión (opcional)" />
                      <SubmitButton name="verdict" value="revisar" className="h-9">Revisada (redactar)</SubmitButton>
                      <SubmitButton name="verdict" value="descartar" variant="outline" className="h-9">Descartar</SubmitButton>
                      <SubmitButton name="verdict" value="borrar" variant="destructive" className="h-9">Borrar</SubmitButton>
                    </ActionForm>
                  )}
                  {r.review_status === "revisada" && r.cohort === "real" && (
                    <details><summary className="cursor-pointer text-primary">Convertir en evidencia</summary>
                      <ActionForm action={responseToEvidence.bind(null, slug, r.id)} className="mt-2 max-w-xl space-y-2">
                        <TextAreaField name="statement" label="Episodio (sin nombres): qué pasó, frecuencia, costo, solución" rows={3} />
                        <FieldError name="statement" />
                        <SelectField name="finding_id" label="Hipótesis" options={[{ value: "", label: "— sin vincular —" }, ...(hyps ?? []).map((h) => ({ value: h.id, label: `${h.dedup_key?.slice(4)} · ${h.statement.slice(0, 70)}` }))]} />
                        <SelectField name="stance" label="Relación" options={[{ value: "supports", label: "A favor" }, { value: "contradicts", label: "En contra (contraevidencia)" }, { value: "contextual", label: "Contexto" }]} />
                        <SubmitButton className="h-8">Crear evidencia (declaración)</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <EmptyState title="No hay respuestas en esta vista" />}
        <Section title="Pedido de borrado">
          <ActionForm action={deleteByCode.bind(null, slug, id)} className="flex max-w-md items-end gap-2 space-y-0">
            <TextField name="code" label="Código de respuesta" />
            <SubmitButton variant="destructive" className="h-9">Borrar</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
