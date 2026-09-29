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
import { GAPS, dimensionLabel, isAssessmentStale, metrics, type Dimension, type EvidenceLink, type Gap } from "@/domain/readiness";
import { entityHref, companyName } from "@/server/entities";
import { PageHeader, Pill, Section, VerificationBadge, formatDate } from "@/components/app/bits";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { decideProposalAction } from "../../capturas/actions";
import { assessFindingNow, linkEvidence } from "../actions";

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
    .select("id, statement, kind, analysis, review_status, created_at, created_by, company_id, companies(id, trade_name, legal_name), sources(title, url, reference), finding_evidence(stance, note, created_at, evidence(id, statement, quote, verification_status, origin_kind, observed_at, revalidate_after, company_id, stated_by_contact_id, capture_id, capture_media_id, media_start_ms, visit_id, source_id, declared_by, companies(trade_name, legal_name), stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name, role_title)))")
    .eq("id", id)
    .maybeSingle();
  if (!f) notFound();

  const [{ data: assessment }, { data: proposals }, { data: tasks }, { data: candidates }] = await Promise.all([
    supabase.from("finding_assessments").select("id, created_at, evidence_ids, dimensions, gaps, summary, supports, contradicts, independent_cases").eq("finding_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("proposals").select("id, status, payload, result_id").eq("finding_id", id).order("created_at", { ascending: false }).order("position"),
    supabase.from("tasks").select("id, title, status, due_on, description").eq("finding_id", id).order("created_at", { ascending: false }),
    supabase.from("evidence").select("id, statement, companies(trade_name, legal_name), observed_at").order("created_at", { ascending: false }).limit(60),
  ]);

  const rows = f.finding_evidence.filter((x) => x.evidence).map((x) => ({ stance: x.stance as EvidenceLink["stance"], note: x.note, e: x.evidence! }));
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
            <Pill>{findingKind.label(f.kind)}</Pill>
            <Pill>{reviewStatus.label(f.review_status)}</Pill>
            {f.companies && <Link href={entityHref(slug, "company", f.companies.id)} className="text-primary hover:underline">{companyName(f.companies)}</Link>}
            <span className="text-xs">Un finding no es una oportunidad: primero se valida.</span>
          </span>
        }
      />

      <Section title="Estado actual">
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
          <p className="text-sm">
            <span className="font-medium text-emerald-800 dark:text-emerald-300">{m.supports} a favor</span> ·{" "}
            <span className={cn("font-medium", m.contradicts ? "text-destructive" : "text-muted-foreground")}>{m.contradicts} en contra</span> ·{" "}
            <span className="font-medium">{m.independentCases} {m.independentCases === 1 ? "caso independiente" : "casos independientes"}</span>
            {m.stale > 0 && <span className="text-orange-700"> · {m.stale} desactualizada{m.stale === 1 ? "" : "s"}</span>}
          </p>
          {assessment?.summary && <p className="text-sm">{assessment.summary}</p>}
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
