import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarClock, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { workspaceCover } from "@/domain/photos";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { taskStatus } from "@/domain/catalogs";
import { addDays, missionDay } from "@/domain/today";
import { GAPS, valueOfInformation, type Dimension, type Gap } from "@/domain/readiness";
import { changesSince } from "@/server/findings/effects";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { Section, formatDate } from "@/components/app/bits";
import { PhonePendingNote } from "@/components/app/capture/capture-dock";
import { setHomeView } from "./home-actions";
import { ExecutiveView } from "./executive";
import { isMissionBriefContent } from "@/domain/brief/mission-brief";

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
export default async function TodayPage({ params, searchParams }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  // La puerta de entrada es el RELEVO nuevo; el panel anterior queda a mano con ?panel=1.
  if ((await searchParams).panel !== "1") redirect(`/hoy/${slug}`);
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const today = todayAR();
  const soon = addDays(today, 7);
  const base = `/w/${slug}`;

  const [{ data: profile }, { data: pref }, { data: mission }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    supabase.from("user_preferences").select("home").eq("user_id", ctx.user.id).eq("workspace_id", ctx.workspace.id).maybeSingle(),
    supabase.from("campaigns").select("id, name, objective, starts_on, ends_on").eq("kind", "mision").eq("status", "activa").order("created_at").limit(1).maybeSingle(),
  ]);
  const stored = (pref?.home as { view?: string } | null)?.view;
  const view: "operativa" | "ejecutiva" = stored === "ejecutiva" || stored === "operativa" ? stored : ctx.role === "admin" ? "ejecutiva" : "operativa";
  const other = view === "operativa" ? "ejecutiva" : "operativa";

  const [tasks, targets, plansToday, captures, drafts, findings, decisions, proposalsPending] = await Promise.all([
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
    supabase.from("proposals").select("capture_id").eq("status", "propuesta").not("capture_id", "is", null),
  ]);
  // D/E: último estado de cada finding, validaciones propuestas y agendadas, errores y qué cambió desde ayer.
  const yesterday = new Date(Date.parse(`${today}T12:00:00-03:00`) - 86_400_000).toISOString();
  const [{ data: assessments }, { data: validations }, { data: validationTasks }, { count: captureErrors }, changes, { data: approvedFindings }, { count: unresolvedCount }, { data: helpForMe }] = await Promise.all([
    supabase.from("finding_assessments").select("finding_id, gaps, dimensions, supports, independent_cases, contradicts, created_at, findings!inner(statement, review_status, maturity, case_status)").neq("findings.review_status", "rechazado").eq("findings.case_status", "activo").order("created_at", { ascending: false }).limit(200),
    supabase.from("proposals").select("finding_id, payload, position").eq("status", "propuesta").not("finding_id", "is", null).order("position"),
    supabase.from("tasks").select("finding_id, title, due_on").not("finding_id", "is", null).neq("status", "done").order("due_on", { nullsFirst: false }),
    supabase.from("captures").select("id", { count: "exact", head: true }).eq("status", "error"),
    changesSince(supabase, yesterday, today),
    supabase.from("findings").select("id, statement, maturity").eq("review_status", "aprobado").eq("case_status", "activo").order("created_at", { ascending: false }).limit(20),
    supabase.from("unresolved_entities").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase.from("help_requests").select("id, ask, finding_id").eq("assignee_id", ctx.user.id).in("status", ["abierto", "en_curso"]).limit(3),
  ]);
  // Oportunidades activas: proyectos, casos en estudio y oportunidades del equipo (no son la misión).
  const [{ data: projects }, { data: cases }, { data: opps }, { data: lastBrief }] = await Promise.all([
    supabase.from("campaigns").select("id, name, objective, status, campaign_targets(count), findings(count)").eq("kind", "proyecto").in("status", ["activa", "borrador", "pausada"]).order("updated_at", { ascending: false }),
    supabase.from("findings").select("id, statement").eq("maturity", "caso").eq("case_status", "activo").eq("review_status", "aprobado").limit(10),
    supabase.from("opportunities").select("id, title, status, stage, next_action").neq("status", "rechazada").order("updated_at", { ascending: false }).limit(10),
    supabase.from("briefs").select("id, brief_date, content").eq("status", "generado").order("brief_date", { ascending: false }).limit(1).maybeSingle(),
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
      {visitsToday.length || research.length || myVotes.length || helpForMe?.length ? (
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
          {(helpForMe ?? []).map((h) => (
            <li key={h.id}>
              <Link href={h.finding_id ? `${base}/hallazgos/${h.finding_id}` : base} className="flex min-h-14 gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs hover:bg-muted/50">
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium">{h.ask}</span>
                  <span className="block text-xs text-muted-foreground"><span className="font-medium">Por qué:</span> te pidieron ayuda en un caso; se responde desde la vista ejecutiva o el caso.</span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
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

  const findingsToValidate = [...latestByFinding.values()].filter((a) => (a.gaps as Gap[]).length).slice(0, 4);
  // Recién aceptada: ya es una hipótesis abierta aunque la evaluación (unos segundos) no haya terminado.
  const evaluating = (approvedFindings ?? []).filter((f) => !latestByFinding.has(f.id)).slice(0, 2);
  // RELEVO está viendo: qué cambió en lo que sabemos (no actividad): se fortaleció, se debilitó, contradice,
  // hipótesis nuevas, qué frena a las abiertas y lo que todavía no sabemos.
  const gapCount = new Map<Gap, number>();
  for (const a of latestByFinding.values()) for (const g of a.gaps as Gap[]) gapCount.set(g, (gapCount.get(g) ?? 0) + 1);
  const topUnknowns = [...gapCount].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const disputed = [...latestByFinding.values()].filter((a) => (a.gaps as Gap[]).includes("contradiccion_sin_resolver"));
  // Morning Brief: lo que importa hoy afuera (el brief completo vive en su página y llega por email).
  const briefPoints = isMissionBriefContent(lastBrief?.content)
    ? lastBrief.content.brief.items.map((x) => ({ text: x.title }))
    : ((lastBrief?.content as { headline_points?: { text: string }[]; quiet_day_note?: string } | null)?.headline_points ?? []).slice(0, 5);
  const Brief = lastBrief ? (
    <Section title={lastBrief.brief_date === today ? "Morning Brief de hoy" : `Último Morning Brief (${formatDate(lastBrief.brief_date)})`} actions={<Link href={`${base}/brief/${lastBrief.id}`} className={linkCls}>Abrir</Link>}>
      <List>
        {briefPoints.length ? briefPoints.map((p, i) => <Row key={i} href={`${base}/brief/${lastBrief.id}`} title={p.text} />) : <Row href={`${base}/brief/${lastBrief.id}`} title={isMissionBriefContent(lastBrief.content) ? lastBrief.content.brief.opening : (lastBrief.content as { quiet_day_note?: string }).quiet_day_note || "Sin cambios relevantes"} />}
      </List>
    </Section>
  ) : null;
  const Watching = (
    <Section title="RELEVO está viendo" actions={<Link href={`${base}/oportunidades`} className={linkCls}>Hipótesis</Link>}>
      {changes.effects.length || changes.newFindings.length || disputed.length || latestByFinding.size || evaluating.length ? (
        <List>
          {changes.effects.map((e) => (
            <Row key={e.findingId} href={`${base}/hallazgos/${e.findingId}`} title={e.text} tone={e.kinds.includes("contradice") ? "danger" : undefined} meta={e.kinds.includes("contradice") ? "Perdió fuerza: contraevidencia nueva" : "Ganó fuerza desde ayer"} />
          ))}
          {changes.newFindings.map((f) => (
            <Row key={f.id} href={`${base}/hallazgos/${f.id}`} title={f.proposed ? `Nueva hipótesis propuesta: ${quote(f.statement)}` : `Nueva hipótesis: ${quote(f.statement)}`} meta={f.proposed ? "Pendiente de revisión: todavía no es una hipótesis abierta" : undefined} />
          ))}
          {evaluating.map((f) => (
            <Row key={f.id} href={`${base}/hallazgos/${f.id}`} title={f.statement} meta={`${MATURITY[f.maturity]} · evaluando qué falta saber…`} />
          ))}
          {disputed.filter((a) => !changes.effects.some((e) => e.findingId === a.finding_id)).slice(0, 3).map((a) => (
            <Row key={a.finding_id} href={`${base}/hallazgos/${a.finding_id}`} title={a.findings.statement} tone="danger" meta={`En disputa: hay evidencia en contra sin resolver · ${a.independent_cases} ${a.independent_cases === 1 ? "caso" : "casos"}`} />
          ))}
          {!changes.effects.length && !changes.newFindings.length && findingsToValidate.filter((a) => !disputed.includes(a)).slice(0, 3).map((a) => {
            const gap = (a.gaps as Gap[])[0];
            return <Row key={a.finding_id} href={`${base}/hallazgos/${a.finding_id}`} title={a.findings.statement} meta={`${MATURITY[a.findings.maturity]} · ${GAPS[gap].label.toLowerCase()} · ${a.independent_cases} ${a.independent_cases === 1 ? "caso" : "casos"}`} />;
          })}
          {topUnknowns.length > 0 && (
            <li className="px-4 py-3 text-sm">
              <span className="font-medium">Lo que todavía no sabemos: </span>
              <span className="text-muted-foreground">{topUnknowns.map(([g, n]) => `${GAPS[g].label.toLowerCase()} (${n} ${n === 1 ? "hipótesis" : "hipótesis"})`).join(" · ")}</span>
            </li>
          )}
        </List>
      ) : (
        <NextStep text="Todavía no hay hipótesis abiertas: surgen de lo que contás en campo. Contale algo a RELEVO." href={`${base}/capturas`} cta="Ver capturas" />
      )}
    </Section>
  );

  const Projects = (
    <Section title="Oportunidades activas" actions={<Link href={`${base}/explorar`} className={linkCls}>Misión y proyectos</Link>}>
      {(projects ?? []).length || (cases ?? []).length || (opps ?? []).length ? (
        <List>
          {(projects ?? []).map((pj) => (
            <Row key={pj.id} href={`${base}/explorar/c/${pj.id}`} title={pj.name} meta={["Proyecto", pj.objective, `${pj.campaign_targets[0]?.count ?? 0} entidades`, `${pj.findings[0]?.count ?? 0} hipótesis`].filter(Boolean).join(" · ")} />
          ))}
          {(cases ?? []).map((c) => (
            <Row key={c.id} href={`${base}/hallazgos/${c.id}`} title={c.statement} meta="Caso en estudio" />
          ))}
          {(opps ?? []).map((o) => (
            <Row key={o.id} href={`${base}/oportunidades/o/${o.id}`} title={o.title} meta={[o.status === "candidata" ? "Oportunidad candidata" : "Oportunidad en dealflow", o.next_action ? `sigue: ${o.next_action}` : null].filter(Boolean).join(" · ")} />
          ))}
        </List>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no hay proyectos ni oportunidades: aparecen cuando una señal tiene evidencia suficiente. Cero también es un resultado válido.</p>
      )}
    </Section>
  );

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
            <p className="text-xs font-medium tracking-[0.2em] text-[oklch(0.85_0.1_60)] uppercase">Hoy · {formatDate(today)} · {profile?.display_name || ctx.user.email}</p>
            <h1 className="text-2xl font-semibold tracking-tight">RELEVO — {mission?.name ?? "tu misión"}</h1>
            <p className="max-w-2xl text-sm text-white/85">{mission?.objective || MISSION}</p>
            {mission && (
              <p className="text-sm text-white/85">
                <Link href={`${base}/explorar/c/${mission.id}`} className="underline-offset-2 hover:underline">Misión</Link>
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
      {view === "operativa" ? (
        <div className="space-y-8">
          {Brief}
          <div className="grid gap-8 lg:grid-cols-2">
            {Watching}
            {Priorities}
          </div>
          <div className="grid gap-8 lg:grid-cols-2">
            {Projects}
            {Hygiene}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`${base}/agenda`} className={linkCls}>Agenda de campo</Link>
            <Link href={`${base}/explorar/actividades?de=mias`} className={linkCls}>Mis próximas acciones{actions.length ? ` (${actions.length})` : ""}</Link>
            <Link href={`${base}/mapa`} className={linkCls}>Mapa del territorio</Link>
            <Link href={`${base}/brief`} className={linkCls}>Morning Brief</Link>
            <Link href={`${base}/radar`} className={linkCls}>Radar</Link>
            <Link href={`${base}/investigacion`} className={linkCls}>Investigación</Link>
            <Link href={`${base}/noticias`} className={linkCls}>Noticias</Link>
          </p>
        </div>
      ) : (
        <ExecutiveView supabase={supabase} slug={slug} userId={ctx.user.id} canApprove={ctx.canApprove} since={`${addDays(today, -14)}T00:00:00-03:00`} />
      )}
    </>
  );
}

const MATURITY: Record<string, string> = { idea: "Idea", hipotesis: "Hipótesis", finding: "Finding", caso: "Caso en estudio" };
const MISSION = "Descubrir, validar y desarrollar oportunidades de inversión y negocio a partir de necesidades reales, evidencia de campo e inteligencia de mercado.";
