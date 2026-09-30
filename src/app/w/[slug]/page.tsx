import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { workspaceCover } from "@/domain/photos";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dealflowStage, taskStatus } from "@/domain/catalogs";
import { addDays, missionDay } from "@/domain/today";
import { GAPS, valueOfInformation, type Dimension, type Gap } from "@/domain/readiness";
import { changesSince } from "@/server/findings/effects";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { Section, formatDate } from "@/components/app/bits";
import { PhonePendingNote } from "@/components/app/capture/capture-dock";
import { setHomeView } from "./home-actions";
import { loadNews } from "@/server/news/queries";
import { ago } from "@/components/app/news-list";
import { NewsAutoRefresh } from "@/components/app/news-auto-refresh";

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

const viewLabel = { operativa: "operativo", ejecutiva: "ejecutivo" } as const;
const linkCls = "text-sm text-primary hover:underline";

/** Fila tocable de una lista de HOY (objetivo táctil ≥ 48 px). */
function Row({ href, title, meta, tone }: { href: string; title: ReactNode; meta?: ReactNode; tone?: "danger" | "muted" }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          {meta && <div className={cn("text-xs text-muted-foreground", tone === "danger" && "text-destructive")}>{meta}</div>}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y rounded-xl border bg-card shadow-xs">{children}</ul>;
}

/** En lugar de un recuadro vacío: una acción concreta (V13 §4.1). */
function NextStep({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <p className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
      {text}
      <Link href={href} className="font-medium text-primary hover:underline">{cta}</Link>
    </p>
  );
}

// HOY: el centro operativo. Tano y Fran ven los mismos datos con otra jerarquía;
// la vista es una preferencia personal, no un permiso.
export default async function TodayPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const today = todayAR();
  const soon = addDays(today, 7);
  const weekAgo = addDays(today, -7);
  const base = `/w/${slug}`;

  const [{ data: profile }, { data: pref }, { data: mission }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    supabase.from("user_preferences").select("home").eq("user_id", ctx.user.id).eq("workspace_id", ctx.workspace.id).maybeSingle(),
    supabase.from("campaigns").select("id, name, starts_on, ends_on").eq("status", "activa").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const stored = (pref?.home as { view?: string } | null)?.view;
  const view: "operativa" | "ejecutiva" = stored === "ejecutiva" || stored === "operativa" ? stored : ctx.role === "admin" ? "ejecutiva" : "operativa";
  const other = view === "operativa" ? "ejecutiva" : "operativa";

  const [tasks, targets, plansToday, captures, drafts, findings, decisions, changed, news, proposalsPending] = await Promise.all([
    supabase.from("tasks").select("id, title, status, due_on, opportunity_id, finding_id, findings(statement)").eq("assignee_id", ctx.user.id).neq("status", "done").or(`due_on.lte.${soon},due_on.is.null`).order("due_on", { nullsFirst: false }).limit(8),
    supabase
      .from("campaign_targets")
      .select(`id, next_action, next_action_due, owner_id, ${targetEntitySelect}`)
      .not("next_action", "is", null)
      .neq("status", "descartado")
      .or(`owner_id.eq.${ctx.user.id},owner_id.is.null`)
      .lte("next_action_due", soon)
      .order("next_action_due")
      .limit(8),
    supabase.from("visit_plans").select("id, title, visit_stops(id, status, target_time)").eq("planned_on", today).order("created_at"),
    supabase.from("captures").select("id", { count: "exact", head: true }).eq("status", "guardado"),
    supabase.from("ai_action_drafts").select("id", { count: "exact", head: true }).eq("status", "propuesta"),
    supabase.from("findings").select("id", { count: "exact", head: true }).eq("review_status", "pendiente_revision"),
    supabase.from("decisions").select("id, question, due_on, opportunity_id, opportunities(title)").eq("status", "requested").order("due_on", { nullsFirst: false }).order("created_at", { ascending: false }).limit(5),
    supabase.from("opportunities").select("id, title, status, stage, next_action, next_action_due, updated_at").gte("updated_at", weekAgo).order("updated_at", { ascending: false }).limit(4),
    loadNews(supabase, ctx.workspace.id, 3),
    supabase.from("proposals").select("capture_id").eq("status", "propuesta").not("capture_id", "is", null),
  ]);
  // D/E: último estado de cada finding, validaciones propuestas y agendadas, errores y qué cambió desde ayer.
  const yesterday = new Date(Date.parse(`${today}T12:00:00-03:00`) - 86_400_000).toISOString();
  const [{ data: assessments }, { data: validations }, { data: validationTasks }, { count: captureErrors }, changes, { data: approvedFindings }, { count: unresolvedCount }] = await Promise.all([
    supabase.from("finding_assessments").select("finding_id, gaps, dimensions, supports, independent_cases, contradicts, created_at, findings!inner(statement, review_status, maturity)").neq("findings.review_status", "rechazado").order("created_at", { ascending: false }).limit(200),
    supabase.from("proposals").select("finding_id, payload, position").eq("status", "propuesta").not("finding_id", "is", null).order("position"),
    supabase.from("tasks").select("finding_id, title, due_on").not("finding_id", "is", null).neq("status", "done").order("due_on", { nullsFirst: false }),
    supabase.from("captures").select("id", { count: "exact", head: true }).eq("status", "error"),
    changesSince(supabase, yesterday, today),
    supabase.from("findings").select("id, statement, maturity").eq("review_status", "aprobado").order("created_at", { ascending: false }).limit(20),
    supabase.from("unresolved_entities").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);
  const latestByFinding = new Map<string, NonNullable<typeof assessments>[number]>();
  for (const a of assessments ?? []) if (!latestByFinding.has(a.finding_id)) latestByFinding.set(a.finding_id, a);
  const quote = (s: string) => `«${s.length > 70 ? `${s.slice(0, 70)}…` : s}»`;
  // E4: qué validación reduce más la incertidumbre que importa para decidir (sin puntaje visible).
  const research = valueOfInformation(
    [...latestByFinding.values()].map((a) => ({
      findingId: a.finding_id,
      statement: a.findings.statement,
      gaps: a.gaps as Gap[],
      dimensions: a.dimensions as unknown as Dimension[],
      supports: a.supports,
      contradicts: a.contradicts,
      independentCases: a.independent_cases,
      proposed: (validations ?? []).filter((v) => v.finding_id === a.finding_id).map((v) => v.payload as { title: string; why: string; gap: Gap }),
      scheduled: (validationTasks ?? []).filter((t) => t.finding_id === a.finding_id).map((t) => ({ title: t.title, due: t.due_on })),
    })),
  );
  const proposalCount = proposalsPending.data?.length ?? 0;
  const capturesToReview = new Set((proposalsPending.data ?? []).map((p) => p.capture_id)).size;

  // --- Acciones: mis follow-ups + próximas acciones de objetivos, vencidas o en 7 días ---
  type Action = { id: string; title: string; entity?: string; due: string | null; href: string; why?: string };
  const actions: Action[] = [
    ...(tasks.data ?? []).map((t) => ({
      id: `t-${t.id}`,
      title: t.title,
      entity: t.findings ? `valida ${quote(t.findings.statement)}` : taskStatus.label(t.status),
      due: t.due_on,
      href: t.finding_id ? `${base}/hallazgos/${t.finding_id}` : t.opportunity_id ? `${base}/oportunidades/o/${t.opportunity_id}` : `${base}/oportunidades`,
      why: t.findings ? "Es una validación: reduce la incertidumbre de un finding." : undefined,
    })),
    ...(targets.data ?? []).flatMap((a) => {
      const e = resolveTargetEntity(a);
      return [{
        id: `a-${a.id}`,
        title: a.next_action ?? "",
        entity: [e?.name, a.owner_id ? null : "sin responsable"].filter(Boolean).join(" · "),
        due: a.next_action_due,
        href: e ? entityHref(slug, e.kind, e.id) : `${base}/explorar`,
      }];
    }),
  ].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const pendingCaptures = captures.count ?? 0;

  const overdueAdmin = actions.filter((a) => a.due && a.due < today && !a.why);
  const visitsToday = plansToday.data ?? [];
  // Una decisión que espera tu voto también es "qué hacer ahora": destraba o cierra una hipótesis.
  const myVotes = ctx.canApprove ? (decisions.data ?? []).slice(0, 2) : [];
  const researchSlots = Math.max(1, 3 - (visitsToday.length ? 1 : 0) - myVotes.length);
  // --- Bloques ---
  // Prioridades de investigación: qué hacer ahora y por qué. La higiene del sistema va aparte.
  const Priorities = (
    <Section title="Qué hacer ahora">
      {visitsToday.length || research.length || myVotes.length ? (
        <ol className="space-y-2">
          {visitsToday.length > 0 && (
            <li>
              <Link href={visitsToday.length === 1 ? `${base}/agenda/${visitsToday[0].id}` : `${base}/agenda`} className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs hover:bg-muted/50">
                <CalendarClock className="size-6 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{visitsToday.length === 1 ? visitsToday[0].title : `${visitsToday.length} jornadas de visitas hoy`}</span>
                  <span className="block text-xs text-muted-foreground">{visitsToday.reduce((n, p) => n + p.visit_stops.length, 0)} paradas · tiene hora hoy</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          )}
          {myVotes.map((d) => (
            <li key={d.id}>
              <Link href={d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`} className="flex min-h-14 gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs hover:bg-muted/50">
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium">{d.question}</span>
                  <span className="block text-xs text-muted-foreground"><span className="font-medium">Por qué:</span> espera tu voto{d.due_on ? ` (vence ${formatDate(d.due_on)})` : ""}; sin decisión no avanza.</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
          {research.slice(0, researchSlots).map((r, i) => (
            <li key={r.findingId}>
              <Link href={`${base}/hallazgos/${r.findingId}`} className="flex min-h-14 gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs hover:bg-muted/50">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium">{r.action}</span>
                  {r.scheduled && <span className="block text-xs font-medium text-primary">Validación agendada</span>}
                  <span className="block text-xs text-muted-foreground"><span className="font-medium">Por qué:</span> {r.why}</span>
                  {r.toLearn.length > 0 && <span className="block text-xs text-muted-foreground"><span className="font-medium">Qué falta aprender:</span> {r.toLearn.join(", ").toLowerCase()}.</span>}
                  <span className="block text-xs text-muted-foreground">Hipótesis: {quote(r.statement)}</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <NextStep text="Todavía no hay hipótesis que validar: surgen de lo que capturás en campo." href={`${base}/capturas`} cta="Ver capturas" />
      )}
    </Section>
  );

  const Changes24 = changes.effects.length || changes.newFindings.length ? (
    <Section title="Qué cambió desde ayer">
      <List>
        {changes.effects.map((e) => (
          <Row key={e.findingId} href={`${base}/hallazgos/${e.findingId}`} title={e.text} tone={e.kinds.includes("contradice") ? "danger" : undefined} />
        ))}
        {changes.newFindings.map((f) => (
          <Row key={f.id} href={`${base}/hallazgos/${f.id}`} title={f.proposed ? `Nueva hipótesis propuesta: ${quote(f.statement)}` : `Nueva hipótesis: ${quote(f.statement)}`} meta={f.proposed ? "Pendiente de revisión: todavía no es una hipótesis abierta" : undefined} />
        ))}
      </List>
    </Section>
  ) : null;

  // Higiene del sistema: necesario, pero no desplaza a las validaciones de mayor valor.
  const hygiene = [
    capturesToReview ? { href: `${base}/capturas`, title: `${capturesToReview} ${capturesToReview === 1 ? "captura con propuestas" : "capturas con propuestas"} por revisar`, meta: `${proposalCount} propuestas` } : null,
    pendingCaptures ? { href: `${base}/capturas`, title: `${pendingCaptures} ${pendingCaptures === 1 ? "captura sin procesar" : "capturas sin procesar"}`, meta: "Material de campo que todavía no es evidencia" } : null,
    captureErrors ? { href: `${base}/capturas`, title: `${captureErrors} ${captureErrors === 1 ? "captura con error" : "capturas con error"}`, meta: "Reintentar el procesamiento", danger: true } : null,
    (findings.count ?? 0) + (drafts.count ?? 0) ? { href: `${base}/oportunidades`, title: `${(findings.count ?? 0) + (drafts.count ?? 0)} hallazgos o borradores por revisar`, meta: `${findings.count ?? 0} hallazgos · ${drafts.count ?? 0} borradores de RELEVO AI` } : null,
    unresolvedCount ? { href: `${base}/explorar/sin-identificar`, title: `${unresolvedCount} ${unresolvedCount === 1 ? "organización o persona" : "organizaciones o personas"} sin identificar`, meta: "Ya aportan evidencia: resolvelas cuando sepas quiénes son" } : null,
    overdueAdmin.length ? { href: overdueAdmin[0].href, title: `${overdueAdmin.length} ${overdueAdmin.length === 1 ? "pendiente vencido" : "pendientes vencidos"}`, meta: overdueAdmin.slice(0, 2).map((a) => a.title).join(" · "), danger: true } : null,
  ].filter((x): x is { href: string; title: string; meta: string; danger?: boolean } => !!x);
  const Hygiene = (
    <Section title="Higiene del sistema">
      {hygiene.length ? (
        <List>
          {hygiene.map((h) => <Row key={h.title} href={h.href} title={h.title} meta={h.meta} tone={h.danger ? "danger" : undefined} />)}
        </List>
      ) : (
        <p className="text-sm text-muted-foreground">Todo al día. <PhonePendingNote /></p>
      )}
    </Section>
  );

  const Actions = (
    <Section title="Próximas acciones" actions={<Link href={`${base}/explorar`} className={linkCls}>Objetivos</Link>}>
      {actions.length ? (
        <List>
          {actions.slice(0, 6).map((a) => {
            const overdue = !!a.due && a.due < today;
            return (
              <Row
                key={a.id}
                href={a.href}
                title={a.title}
                tone={overdue ? "danger" : undefined}
                meta={[a.entity, a.due ? `${overdue ? "vencida " : ""}${formatDate(a.due)}` : "sin fecha"].filter(Boolean).join(" · ")}
              />
            );
          })}
        </List>
      ) : (
        <NextStep text="Sin acciones vencidas ni para esta semana." href={`${base}/explorar`} cta="Registrar próxima acción" />
      )}
    </Section>
  );

  const Visits = (
    <Section title="Visitas y reuniones de hoy" actions={<Link href={`${base}/agenda`} className={linkCls}>Agenda</Link>}>
      {plansToday.data?.length ? (
        <List>
          {plansToday.data.map((p) => (
            <Row key={p.id} href={`${base}/agenda/${p.id}`} title={p.title} meta={`${p.visit_stops.length} paradas · ${p.visit_stops.filter((s) => s.status === "realizada").length} hechas`} />
          ))}
        </List>
      ) : (
        <NextStep text="No hay visitas planificadas para hoy." href={`${base}/agenda`} cta="Planificar visita" />
      )}
    </Section>
  );

  const Decisions = (
    <Section title={ctx.canApprove ? "Decisiones que esperan tu voto" : "Decisiones pendientes"} actions={<Link href={`${base}/oportunidades/decisiones`} className={linkCls}>Todas</Link>}>
      {decisions.data?.length ? (
        <List>
          {decisions.data.map((d) => (
            <Row
              key={d.id}
              href={d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`}
              title={d.question}
              tone={d.due_on && d.due_on < today ? "danger" : undefined}
              meta={[d.opportunities?.title, d.due_on ? `vence ${formatDate(d.due_on)}` : null].filter(Boolean).join(" · ")}
            />
          ))}
        </List>
      ) : (
        <NextStep text="No hay decisiones pendientes." href={`${base}/oportunidades/candidatas`} cta="Ver candidatas" />
      )}
    </Section>
  );

  const findingsToValidate = [...latestByFinding.values()].filter((a) => (a.gaps as Gap[]).length).slice(0, 4);
  // Recién aceptada: ya es una hipótesis abierta aunque la evaluación (unos segundos) no haya terminado.
  const evaluating = (approvedFindings ?? []).filter((f) => !latestByFinding.has(f.id)).slice(0, 2);
  const Validate = (
    <Section title="Hipótesis abiertas" actions={<Link href={`${base}/oportunidades`} className={linkCls}>Hallazgos</Link>}>
      {findingsToValidate.length || evaluating.length ? (
        <List>
          {evaluating.map((f) => (
            <Row key={f.id} href={`${base}/hallazgos/${f.id}`} title={f.statement} meta={`${MATURITY[f.maturity]} · evaluando qué falta saber…`} />
          ))}
          {findingsToValidate.map((a) => {
            const gap = (a.gaps as Gap[])[0];
            const v = (validations ?? []).find((x) => x.finding_id === a.finding_id)?.payload as { title: string } | undefined;
            return (
              <Row
                key={a.finding_id}
                href={`${base}/hallazgos/${a.finding_id}`}
                title={a.findings.statement}
                tone={gap === "contradiccion_sin_resolver" ? "danger" : undefined}
                meta={`${MATURITY[a.findings.maturity]} · ${GAPS[gap].label.toLowerCase()} · ${a.independent_cases} ${a.independent_cases === 1 ? "caso" : "casos"}${a.contradicts ? ` · ${a.contradicts} en contra` : ""}${v ? ` · sugerido: ${v.title}` : ""}`}
              />
            );
          })}
        </List>
      ) : (
        <NextStep text="Sin hipótesis abiertas todavía. Surgen de lo que capturás en campo." href={`${base}/capturas`} cta="Ver capturas" />
      )}
    </Section>
  );

  const Changes = (
    <Section title="Cambios en oportunidades (7 días)" actions={<Link href={`${base}/oportunidades/dealflow`} className={linkCls}>Pipeline</Link>}>
      {changed.data?.length ? (
        <List>
          {changed.data.map((o) => (
            <Row
              key={o.id}
              href={`${base}/oportunidades/o/${o.id}`}
              title={o.title}
              meta={[o.stage ? dealflowStage.label(o.stage) : o.status, o.next_action ? `sigue: ${o.next_action}` : "sin próxima acción", `actualizada ${ago(o.updated_at)}`].join(" · ")}
            />
          ))}
        </List>
      ) : (
        <NextStep text="Sin cambios esta semana." href={`${base}/oportunidades`} cta="Ver hallazgos" />
      )}
    </Section>
  );

  const Pulse = (
    <Section title="Market Pulse" actions={<Link href={`${base}/noticias`} className={linkCls}>Todas las noticias</Link>}>
      <NewsAutoRefresh active={news.refreshing} />
      {news.rows.length ? (
        <List>
          {news.rows.slice(0, 3).map((n) => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 flex-col justify-center px-4 py-3 text-sm hover:bg-muted/50">
                <span className="line-clamp-2 font-medium">{n.title}</span>
                <span className="text-xs text-muted-foreground">{n.source_name ?? "Medio sin identificar"} · {ago(n.published_at)}</span>
              </a>
            </li>
          ))}
        </List>
      ) : (
        <p className="text-sm text-muted-foreground">{news.refreshing ? "Buscando noticias…" : "Sin noticias recientes."}</p>
      )}
    </Section>
  );

  const day = mission ? missionDay(today, mission.starts_on, mission.ends_on) : null;

  return (
    <>
      <section className="relative -mx-4 -mt-5 mb-6 overflow-hidden md:mx-0 md:mt-0 md:rounded-2xl">
        <Image
          src={`${workspaceCover(ctx.workspace.settings).src}?w=1800&q=80&auto=format&fit=crop`}
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 64rem, 100vw"
          className="object-cover object-[center_28%]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.18_0.03_248/0.88)] via-[oklch(0.18_0.03_248/0.55)] to-[oklch(0.18_0.03_248/0.2)]" />
        <div className="relative flex flex-col gap-3 p-5 text-white sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div className="space-y-0.5">
            <p className="text-xs font-medium tracking-[0.2em] text-[oklch(0.85_0.1_60)] uppercase">Hoy · {formatDate(today)}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Hola, {profile?.display_name || ctx.user.email}</h1>
            {mission && (
              <p className="text-sm text-white/85">
                <Link href={`${base}/explorar/c/${mission.id}`} className="underline-offset-2 hover:underline">{mission.name}</Link>
                {day && ` · ${day.label}`}
                {day?.phase === "despues" && (
                  <Link href={`${base}/oportunidades/briefings`} className="ml-2 font-medium text-white underline underline-offset-2">Sintetizar</Link>
                )}
              </p>
            )}
          </div>
          <form action={setHomeView.bind(null, slug, other)}>
            <button className="inline-flex h-10 items-center rounded-lg bg-white/15 px-3 text-sm font-medium text-white backdrop-blur hover:bg-white/25">
              Ver vista {viewLabel[other]}
            </button>
          </form>
        </div>
      </section>
      <div className="grid gap-8 lg:grid-cols-2">
        {view === "operativa" ? (
          <>
            {Priorities}
            {Changes24}
            {Visits}
            {Validate}
            {Hygiene}
            {Actions}
            {Decisions}
            {Changes}
            {Pulse}
          </>
        ) : (
          <>
            {Priorities}
            {Changes24}
            {Decisions}
            {Validate}
            {Changes}
            {Hygiene}
            {Actions}
            {Visits}
            {Pulse}
          </>
        )}
      </div>
    </>
  );
}

const MATURITY: Record<string, string> = { idea: "Idea", hipotesis: "Hipótesis", finding: "Finding" };
