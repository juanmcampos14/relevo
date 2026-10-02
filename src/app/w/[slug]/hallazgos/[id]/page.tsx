import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, HelpCircle, ListTodo, Mic, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { evidenceOrigin, findingKind, reviewStatus, taskStatus } from "@/domain/catalogs";
import { formatDuration } from "@/domain/capture";
import { isStale } from "@/domain/evidence";
import { GAPS, dimensionLabel, findingTimeline, isAssessmentStale, metrics, trendSince, type Dimension, type EvidenceLink, type Gap } from "@/domain/readiness";
import { entityHref, companyName } from "@/server/entities";
import { PageHeader, Pill, Section, VerificationBadge, formatDate } from "@/components/app/bits";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { decideProposalAction } from "../../capturas/actions";
import { assessFindingNow, changeCaseState, linkEvidence, promoteMaturity, requestHelp } from "../actions";
import { BASIS_LABEL, ECONOMICS, unknownEconomics, type EconomicFact } from "@/domain/economics";
import { STAGE_LABEL, caseStage, opportunityCriteria } from "@/domain/case";
import { isStrongSource } from "@/domain/provenance";

export const metadata: Metadata = { title: "Estado del finding" };
// El análisis con IA corre en una Server Action de esta página.
export const maxDuration = 120;

const STANCE = {
  supports: { label: "A favor", tone: "border-emerald-500/40 text-emerald-800 dark:text-emerald-300" },
  contradicts: { label: "En contra", tone: "border-destructive/50 text-destructive" },
  contextual: { label: "Contexto", tone: "" },
} as const;

/** Minutos desde una fecha (para refrescar solo mientras el análisis en segundo plano puede estar corriendo). */
function minutesSince(iso: string) {
  return (Date.now() - Date.parse(iso)) / 60_000;
}

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

export default async function FindingStatePage({ params }: PageProps<"/w/[slug]/hallazgos/[id]">) {
  const { slug, id } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const today = todayAR();

  const { data: f } = await supabase
    .from("findings")
    .select("id, statement, kind, analysis, review_status, maturity, case_status, created_at, created_by, company_id, companies(id, trade_name, legal_name), sources(title, url, reference), finding_evidence(stance, note, created_at, evidence(id, statement, quote, sources(title, url), verification_status, origin_kind, observed_at, revalidate_after, company_id, stated_by_contact_id, capture_id, capture_media_id, media_start_ms, visit_id, source_id, declared_by, companies(trade_name, legal_name), stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name, role_title)))")
    .eq("id", id)
    .maybeSingle();
  if (!f) notFound();

  const [{ data: history }, { data: proposals }, { data: tasks }, { data: candidates }, { data: revisions }, { data: opps }, { data: members }, { data: helps }] = await Promise.all([
    supabase.from("finding_assessments").select("id, created_at, evidence_ids, dimensions, gaps, summary, supports, contradicts, independent_cases, economics").eq("finding_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("proposals").select("id, status, payload, result_id").eq("finding_id", id).order("created_at", { ascending: false }).order("position"),
    supabase.from("tasks").select("id, title, status, due_on, description, created_at, completed_at").eq("finding_id", id).order("created_at", { ascending: false }),
    supabase.from("evidence").select("id, statement, companies(trade_name, legal_name), observed_at").order("created_at", { ascending: false }).limit(60),
    supabase.from("finding_revisions").select("kind, relation, previous_value, new_value, reason, created_at, created_by").eq("finding_id", id).order("created_at"),
    supabase.from("opportunity_findings").select("opportunities(id, title, status)").eq("finding_id", id),
    supabase.from("profiles").select("user_id, display_name, email"),
    supabase.from("help_requests").select("id, kind, ask, target, status, result, assignee_id, requested_by, due_on, created_at").eq("finding_id", id).order("created_at", { ascending: false }),
  ]);

  const assessment = history?.[0] ?? null;
  const rows = f.finding_evidence.filter((x) => x.evidence).map((x) => ({ stance: x.stance as EvidenceLink["stance"], note: x.note, linkedAt: x.created_at, e: x.evidence! }));
  const links: EvidenceLink[] = rows.map(({ stance, e }) => ({ id: e.id, stance, verification_status: e.verification_status, revalidate_after: e.revalidate_after, company_id: e.company_id, stated_by_contact_id: e.stated_by_contact_id, capture_id: e.capture_id, visit_id: e.visit_id, source_id: e.source_id }));
  const m = metrics(links, today);
  const linkedIds = new Set(links.map((l) => l.id));
  const stale = assessment ? isAssessmentStale(assessment.evidence_ids, [...linkedIds]) : false;
  const dims = (assessment?.dimensions ?? []) as unknown as Dimension[];
  const gaps = (assessment?.gaps ?? []) as Gap[];
  const evIndex = new Map(rows.map((r, i) => [r.e.id, i + 1]));
  const pending = (proposals ?? []).filter((p) => p.status === "propuesta");
  const byStatus = (s: Dimension["status"]) => dims.filter((d) => d.status === s);
  const captureOfSource = f.sources?.reference?.startsWith("captura:") ? f.sources.reference.slice(8) : null;
  // E3 — cómo llegó hasta acá y qué cambió desde ayer.
  const timeline = findingTimeline({
    createdAt: f.created_at,
    origin: captureOfSource ? "captura de campo" : f.sources?.title ?? null,
    links: rows.map(({ stance, linkedAt, e }) => ({ id: e.id, stance, verification_status: e.verification_status, revalidate_after: e.revalidate_after, company_id: e.company_id, stated_by_contact_id: e.stated_by_contact_id, capture_id: e.capture_id, visit_id: e.visit_id, source_id: e.source_id, linkedAt, statement: e.statement })),
    assessments: (history ?? []).map((a) => ({ at: a.created_at, gaps: a.gaps })),
    validations: (tasks ?? []).map((t) => ({ title: t.title, createdAt: t.created_at, completedAt: t.completed_at })),
    revisions: (revisions ?? []).map((r) => ({ at: r.created_at, kind: r.kind as "enunciado" | "madurez" | "estado", relation: r.relation, previous: r.previous_value, next: r.new_value, reason: r.reason })),
  });
  // Como posible negocio: etapa, economía y criterios de oportunidad (sin puntaje).
  const economics = ((assessment?.economics ?? []) as unknown as EconomicFact[]);
  const openValidation = (tasks ?? []).find((t) => t.status !== "done")?.title ?? pending.map((p) => String((p.payload as { title?: string }).title ?? "")).find(Boolean) ?? null;
  const stage = caseStage({ maturity: f.maturity, independentCases: m.independentCases, hasOpportunity: (opps ?? []).some((o) => o.opportunities && o.opportunities.status !== "rechazada") });
  const criteria = opportunityCriteria({ dims, gaps, metrics: m, economics, nextMilestone: openValidation, strongSources: rows.filter((r) => r.stance === "supports" && isStrongSource(r.e)).length });
  const dimOf = (...keys: string[]) => keys.map((k) => dims.find((d) => d.key === k)).find((d) => d && d.status !== "falta") ?? dims.find((d) => keys.includes(d.key));
  const yesterday = new Date(Date.parse(`${today}T12:00:00-03:00`) - 86_400_000).toISOString();
  const sinceYesterday = timeline.filter((e) => e.at >= yesterday && e.kind !== "apertura");
  const trend = trendSince(timeline, yesterday);
  // Si el análisis se está haciendo en segundo plano (evidencia nueva), la página se refresca sola unos minutos.
  const lastChange = [f.created_at, ...f.finding_evidence.map((x) => x.created_at)].sort().at(-1)!;
  const recentlyChanged = (!assessment || stale) && minutesSince(lastChange) < 3;

  const ref = (ids: string[]) =>
    ids.length ? (
      <span className="ml-1 text-xs">
        {ids.map((eid) => (
          <a key={eid} href={`#ev-${eid}`} className="mr-1 text-primary hover:underline">[{evIndex.get(eid) ?? "?"}]</a>
        ))}
      </span>
    ) : null;

  return (
    <div className="space-y-8">
      <AutoRefresh active={recentlyChanged && ctx.canEdit} everyMs={8000} />
      <PageHeader
        back={<Link href={`${base}/oportunidades?h=${f.id}#h-${f.id}`} className="hover:underline">← Hallazgos</Link>}
        title={f.statement}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Pill className={f.maturity === "finding" || f.maturity === "caso" ? "border-emerald-500/40 text-emerald-800 dark:text-emerald-300" : undefined}>{MATURITY[f.maturity]}</Pill>
            <Pill>{findingKind.label(f.kind)}</Pill>
            <Pill>{reviewStatus.label(f.review_status)}</Pill>
            {f.companies && <Link href={entityHref(slug, "company", f.companies.id)} className="text-primary hover:underline">{companyName(f.companies)}</Link>}
            {f.case_status !== "activo" && <Pill className="border-amber-500/40 text-amber-800 dark:text-amber-300">{CASE_STATUS[f.case_status]}</Pill>}
            <span className="text-xs">{MATURITY_NOTE[f.maturity]}</span>
            {ctx.canEdit && f.maturity !== "caso" && (
              <ActionForm action={promoteMaturity.bind(null, slug, f.id, f.maturity === "idea" ? "hipotesis" : f.maturity === "hipotesis" ? "finding" : "caso")} className="space-y-0">
                <SubmitButton variant="outline">{f.maturity === "idea" ? "Tratar como hipótesis" : f.maturity === "hipotesis" ? "Promover a finding" : "Estudiar como caso"}</SubmitButton>
              </ActionForm>
            )}
          </span>
        }
      />

      {ctx.canEdit && (
        <details className="rounded-xl border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium text-primary">Cambiar estado o madurez (pausar, cerrar, descartar, retroceder…)</summary>
          <ActionForm action={changeCaseState.bind(null, slug, f.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="font-medium">Estado</span>
              <select name="case_status" defaultValue={f.case_status} className="h-10 w-full rounded-lg border bg-background px-3">
                {Object.entries(CASE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="font-medium">Madurez</span>
              <select name="maturity" defaultValue={f.maturity} className="h-10 w-full rounded-lg border bg-background px-3">
                {Object.entries(MATURITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2"><span className="font-medium">Motivo (queda en la historia)</span>
              <textarea name="reason" rows={2} required className="w-full rounded-lg border bg-background px-3 py-2" placeholder="Ej.: la contraevidencia de dos compradores no se sostiene; se pausa hasta hablar con Compras." />
              <FieldError name="reason" />
            </label>
            <div className="sm:col-span-2"><SubmitButton variant="outline">Registrar cambio</SubmitButton></div>
          </ActionForm>
        </details>
      )}

      {(f.maturity === "finding" || f.maturity === "caso") && (
        <Section title="Como posible negocio">
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
            <p className="text-sm"><span className="font-medium">Etapa:</span> {STAGE_LABEL[stage]}{stage !== "oportunidad" && " · todavía no es una oportunidad"}</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {([["Problema observado", ["problema"]], ["Quién lo sufre", ["actor_afectado", "usuario"]], ["Quién podría pagar o decidir", ["comprador", "decisor"]], ["Solución actual", ["solucion_actual", "alternativas"]]] as const).map(([label, keys]) => {
                const d = dimOf(...keys);
                return (
                  <div key={label}>
                    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                    <dd>{d && d.status !== "falta" ? <>{d.summary} <span className="text-xs text-muted-foreground">({d.status === "sabido" ? "sabido" : d.status === "creido" ? "supuesto" : "en disputa"})</span>{ref(d.evidence_ids)}</> : <span className="text-muted-foreground">Desconocido</span>}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="space-y-1">
              <p className="text-sm font-medium">Economía conocida</p>
              {economics.length ? (
                <ul className="space-y-1 text-sm">
                  {economics.map((e) => (
                    <li key={e.variable} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-muted-foreground">{ECONOMICS[e.variable]}:</span>
                      <span>{e.value}</span>
                      <Pill className={e.basis === "estimado" ? "border-amber-500/40" : undefined}>{BASIS_LABEL[e.basis]}{e.formula ? ` · ${e.formula}` : ""}</Pill>
                      {ref(e.evidence_ids)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Sin datos económicos todavía.</p>
              )}
              <p className="text-xs text-muted-foreground">Desconocido: {unknownEconomics(economics).map((k) => ECONOMICS[k].toLowerCase()).join(", ")}.</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Para presentarse como oportunidad {criteria.met ? <span className="text-emerald-700 dark:text-emerald-400">(cumple los criterios: una persona decide)</span> : null}</p>
              <ul className="space-y-1 text-sm">
                {criteria.items.map((c) => (
                  <li key={c.key} className="flex gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Cumple" /> : <HelpCircle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Falta" />}
                    <span><span className="font-medium">{c.label}:</span> <span className="text-muted-foreground">{c.detail}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            {(helps ?? []).length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Pedidos de ayuda</p>
                <ul className="space-y-1 text-sm">
                  {(helps ?? []).map((h) => {
                    const who = (id2: string | null) => (members ?? []).find((mm) => mm.user_id === id2);
                    const name = (id2: string | null) => who(id2)?.display_name || who(id2)?.email || "—";
                    return (
                      <li key={h.id}>
                        <span className="text-muted-foreground">{HELP_KIND[h.kind]} · {name(h.requested_by)} → {name(h.assignee_id)}:</span> {h.ask}
                        <span className="text-xs text-muted-foreground"> · {h.status === "resuelto" ? "resuelto" : h.status === "en_curso" ? "en curso" : h.status === "cancelado" ? "cancelado" : "abierto"}</span>
                        {h.result && <span className="block text-xs">Resultado: {h.result}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">Pedir ayuda (contacto, introducción, acceso, validación…)</summary>
                <ActionForm action={requestHelp.bind(null, slug, f.id)} className="mt-3 space-y-2">
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">A quién</span>
                    <select name="assignee" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" defaultValue="">
                      <option value="" disabled>Elegí…</option>
                      {(members ?? []).filter((mm) => mm.user_id !== ctx.user.id).map((mm) => <option key={mm.user_id} value={mm.user_id}>{mm.display_name || mm.email}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Tipo de ayuda</span>
                    <select name="kind" defaultValue="introduccion" className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                      {Object.entries(HELP_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span className="font-medium">Qué necesitás concretamente</span>
                    <textarea name="ask" rows={2} required placeholder="Una introducción a quien decide compras de alimentación en PECOM" className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block space-y-1 text-sm"><span className="font-medium">A quién buscamos (opcional)</span><input name="target" placeholder="Compras / gerente de base" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label>
                    <label className="block space-y-1 text-sm"><span className="font-medium">Para cuándo (opcional)</span><input name="due_on" type="date" className="h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label>
                  </div>
                  <SubmitButton>Pedir ayuda</SubmitButton>
                </ActionForm>
              </details>
            )}
          </div>
        </Section>
      )}

      <Section title="Estado actual">
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-sm">
            <span className="font-medium text-emerald-800 dark:text-emerald-300">{m.supports} a favor</span> ·{" "}
            <span className={cn("font-medium", m.contradicts ? "text-destructive" : "text-muted-foreground")}>{m.contradicts} en contra</span> ·{" "}
            <span className="font-medium">{m.independentCases} {m.independentCases === 1 ? "caso independiente" : "casos independientes"}</span>
            {m.stale > 0 && <span className="text-orange-700"> · {m.stale} desactualizada{m.stale === 1 ? "" : "s"}</span>}
          </p>
          {assessment?.summary && <p className="text-sm">{assessment.summary}</p>}
          {sinceYesterday.length > 0 && (
            <p className="rounded-lg bg-muted/60 p-2 text-sm">
              <span className="font-medium">Desde ayer {trend === "se_fortalecio" ? "se fortaleció" : trend === "se_debilito" ? "se debilitó" : trend === "en_disputa" ? "está en disputa" : "hubo cambios"}:</span>{" "}
              {sinceYesterday.map((e) => e.text).join(" ")}
            </p>
          )}
          {gaps.length > 0 && (
            <ul className="space-y-1.5">
              {gaps.map((g) => (
                <li key={g} className="flex gap-2 text-sm">
                  <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", g === "contradiccion_sin_resolver" ? "text-destructive" : "text-amber-600")} aria-hidden="true" />
                  <span><span className="font-medium">{GAPS[g].label}.</span> <span className="text-muted-foreground">{GAPS[g].why}</span></span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
            {assessment ? <span>Análisis del {formatDate(assessment.created_at, true)}</span> : <span>Todavía sin analizar.</span>}
            {stale && <span className="font-medium text-amber-700">Hay evidencia nueva desde el último análisis.</span>}
            {ctx.canEdit && (
              <ActionForm action={assessFindingNow.bind(null, slug, f.id)} className="space-y-0">
                <SubmitButton variant="outline" className="h-9">
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {assessment ? "Actualizar análisis" : "Analizar"}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </div>
      </Section>

      {assessment && (
        <>
          <Block title="Qué sabemos" icon={<CheckCircle2 className="size-4 text-emerald-600" />} items={byStatus("sabido")} empty="Nada respaldado por evidencia todavía." renderRef={ref} />
          <Block title="Qué creemos" icon={<HelpCircle className="size-4 text-amber-600" />} items={byStatus("creido")} empty="Sin hipótesis abiertas." renderRef={ref} />
          <Block title="Qué lo contradice" icon={<ShieldAlert className="size-4 text-destructive" />} items={byStatus("contradicho")} empty="Sin contraevidencia registrada (buscala: es tan importante como la evidencia a favor)." renderRef={ref} />
          <Section title="Qué falta saber">
            {byStatus("falta").length ? (
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {byStatus("falta").map((d) => (
                  <li key={d.key} className="flex gap-2 p-3 text-sm">
                    <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span><span className="font-medium">{dimensionLabel(d.key)}:</span> {d.summary}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No hay faltantes detectados.</p>
            )}
          </Section>
        </>
      )}

      <Section title="Qué hacer ahora">
        {pending.length === 0 && !(tasks ?? []).length && <p className="text-sm text-muted-foreground">Sin validaciones propuestas todavía.</p>}
        {pending.length > 0 && (
          <ul className="space-y-3">
            {pending.map((p, i) => {
              const v = p.payload as { title: string; why: string; gap: Gap; who: string | null };
              return (
                <li key={p.id} className="rounded-xl border bg-card p-4 shadow-xs">
                  <ActionForm action={decideProposalAction.bind(null, slug, p.id)} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {i === 0 && <Pill className="border-primary text-primary">Recomendada</Pill>}
                      <Pill>{GAPS[v.gap]?.label ?? v.gap}</Pill>
                    </div>
                    <p className="text-base font-medium">{v.title}</p>
                    <p className="text-sm text-muted-foreground">{v.why}{v.who ? ` · con ${v.who}` : ""}</p>
                    <input type="hidden" name="original" value={JSON.stringify(v)} />
                    {ctx.canEdit && (
                      <div className="flex gap-2">
                        <SubmitButton name="decision" value="aceptar" className="h-11 flex-1 text-base">Agendar</SubmitButton>
                        <SubmitButton name="decision" value="rechazar" variant="outline" className="h-11 flex-1 text-base">Descartar</SubmitButton>
                      </div>
                    )}
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
        {(tasks ?? []).length > 0 && (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {(tasks ?? []).map((t) => (
              <li key={t.id} className="flex items-start gap-2 p-3 text-sm">
                <ListTodo className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn("font-medium", t.status === "done" && "line-through")}>{t.title}</span>
                  <span className="block text-xs text-muted-foreground">{taskStatus.label(t.status)}{t.due_on ? ` · ${formatDate(t.due_on)}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Evidencia (${rows.length})`}>
        {rows.length ? (
          <ol className="space-y-2">
            {rows.map(({ stance, note, e }, i) => (
              <li key={e.id} id={`ev-${e.id}`} className="scroll-mt-20 space-y-1 rounded-xl border bg-card p-3 text-sm shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">[{i + 1}]</span>
                  <Pill className={STANCE[stance].tone}>{STANCE[stance].label}</Pill>
                  <VerificationBadge status={isStale(e, today) && e.verification_status !== "stale" ? "stale" : e.verification_status} />
                </div>
                <p>{e.statement}</p>
                {e.quote && <p className="border-l-2 pl-3 text-muted-foreground italic">“{e.quote}”</p>}
                <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{evidenceOrigin.label(e.origin_kind)}</span>
                  {e.companies && <span>· {companyName(e.companies)}</span>}
                  {e.stated_by && <span>· dicho por {e.stated_by.full_name}{e.stated_by.role_title ? ` (${e.stated_by.role_title})` : ""}</span>}
                  {e.declared_by && <span>· declarado por {e.declared_by}</span>}
                  {e.observed_at && <span>· {formatDate(e.observed_at)}</span>}
                  {e.capture_id && <Link href={`${base}/capturas/${e.capture_id}`} className="text-primary hover:underline">· captura original</Link>}
                  {e.capture_id && e.media_start_ms != null && (
                    <Link href={`${base}/capturas/${e.capture_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      · <Mic className="size-3" aria-hidden="true" /> {formatDuration(e.media_start_ms)}
                    </Link>
                  )}
                  {e.visit_id && <Link href={`${base}/agenda/visita/${e.visit_id}`} className="text-primary hover:underline">· visita</Link>}
                  {e.sources?.url ? (
                    <a href={e.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">· {e.sources.title || "fuente"}</a>
                  ) : e.sources ? <span>· {e.sources.title} (sin link verificable)</span> : null}
                </p>
                {note && <p className="text-xs">Nota: {note}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Sin evidencia vinculada.</p>
        )}
        {ctx.canEdit && (
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">+ Vincular evidencia (p. ej. un segundo caso o una contradicción)</summary>
            <ActionForm action={linkEvidence.bind(null, slug, f.id)} resetOnSuccess className="mt-3">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Evidencia registrada</span>
                <select name="evidence_id" className="h-11 w-full rounded-lg border bg-card px-3 text-base" defaultValue="">
                  <option value="" disabled>— Elegí —</option>
                  {(candidates ?? []).filter((c) => !linkedIds.has(c.id)).map((c) => (
                    <option key={c.id} value={c.id}>{c.statement.slice(0, 90)}{c.companies ? ` · ${companyName(c.companies)}` : ""}</option>
                  ))}
                </select>
                <FieldError name="evidence_id" />
              </label>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 font-medium">Respecto de este finding</legend>
                {(["supports", "contradicts", "contextual"] as const).map((s) => (
                  <label key={s} className="flex min-h-10 items-center gap-2"><input type="radio" name="stance" value={s} className="size-4 accent-primary" />{STANCE[s].label}</label>
                ))}
              </fieldset>
              <FieldError name="stance" />
              <SubmitButton>Vincular</SubmitButton>
            </ActionForm>
          </details>
        )}
      </Section>

      <Section title="Cómo llegó hasta acá">
        <ol className="space-y-2 border-l-2 pl-4">
          {timeline.map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className={cn("absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full", e.kind === "contradiccion" ? "bg-destructive" : e.kind === "caso" || e.kind === "faltante_resuelto" ? "bg-emerald-600" : "bg-muted-foreground/50")} aria-hidden="true" />
              <span className="block text-xs text-muted-foreground">{formatDate(e.at, true)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="De dónde salió">
        <p className="text-sm">
          Fuente:{" "}
          {captureOfSource ? (
            <Link href={`${base}/capturas/${captureOfSource}`} className="text-primary hover:underline">{f.sources?.title}</Link>
          ) : f.sources?.url ? (
            <a href={f.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{f.sources.title}</a>
          ) : (
            f.sources?.title ?? "—"
          )}
          <span className="text-muted-foreground"> · registrado {formatDate(f.created_at)}</span>
        </p>
        {f.analysis && <p className="text-sm text-muted-foreground">{f.analysis}</p>}
      </Section>
    </div>
  );
}

function Block({ title, icon, items, empty, renderRef }: { title: string; icon: ReactNode; items: Dimension[]; empty: string; renderRef: (ids: string[]) => ReactNode }) {
  return (
    <Section title={title}>
      {items.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {items.map((d) => (
            <li key={d.key} className="flex gap-2 p-3 text-sm">
              <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span>
              <span><span className="font-medium">{dimensionLabel(d.key)}:</span> {d.summary}{renderRef(d.evidence_ids)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </Section>
  );
}

const MATURITY: Record<string, string> = { idea: "Idea", hipotesis: "Hipótesis", finding: "Finding", caso: "Caso en estudio" };
const HELP_KIND: Record<string, string> = { contacto: "Contacto", introduccion: "Introducción", acceso: "Acceso", validacion: "Validación", aprobacion: "Aprobación", capital: "Capital", conocimiento: "Conocimiento sectorial" };
const CASE_STATUS: Record<string, string> = { activo: "Activo", pausado: "Pausado", cerrado: "Cerrado", descartado: "Descartado" };
const MATURITY_NOTE: Record<string, string> = {
  idea: "Una idea de quien capturó: todavía sin evidencia de demanda.",
  hipotesis: "Hipótesis exploratoria: pasa a finding cuando la evidencia sostiene un patrón (decisión humana).",
  finding: "Un finding no es una oportunidad: primero se valida.",
  caso: "Caso en estudio: se analiza como posible negocio; pasa a oportunidad cuando cumple los criterios (decisión humana).",
};
