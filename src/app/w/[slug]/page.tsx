import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { workspaceCover } from "@/domain/photos";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dealflowStage, taskStatus } from "@/domain/catalogs";
import { addDays, missionDay, pickPriorities, type PriorityItem } from "@/domain/today";
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

  const [tasks, targets, plansToday, captures, drafts, findings, decisions, changed, news] = await Promise.all([
    supabase.from("tasks").select("id, title, status, due_on, opportunity_id").eq("assignee_id", ctx.user.id).neq("status", "done").or(`due_on.lte.${soon},due_on.is.null`).order("due_on", { nullsFirst: false }).limit(8),
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
    supabase.from("decisions").select("id, question, due_on, opportunity_id, opportunities(title)").eq("status", "requested").order("due_on", { nullsFirst: false }).limit(5),
    supabase.from("opportunities").select("id, title, status, stage, next_action, next_action_due, updated_at").gte("updated_at", weekAgo).order("updated_at", { ascending: false }).limit(4),
    loadNews(supabase, ctx.workspace.id, 3),
  ]);

  // --- Acciones: mis follow-ups + próximas acciones de objetivos, vencidas o en 7 días ---
  type Action = { id: string; title: string; entity?: string; due: string | null; href: string };
  const actions: Action[] = [
    ...(tasks.data ?? []).map((t) => ({
      id: `t-${t.id}`,
      title: t.title,
      entity: taskStatus.label(t.status),
      due: t.due_on,
      href: t.opportunity_id ? `${base}/oportunidades/o/${t.opportunity_id}` : `${base}/oportunidades`,
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
  const toReview = (drafts.count ?? 0) + (findings.count ?? 0);

  const priorityItems: PriorityItem[] = [
    ...actions.map((a) => ({
      kind: a.due && a.due < today ? ("accion_vencida" as const) : ("accion_hoy" as const),
      title: a.title,
      detail: [a.entity, a.due ? (a.due < today ? `vencida ${formatDate(a.due)}` : formatDate(a.due)) : null].filter(Boolean).join(" · "),
      href: a.href,
      due: a.due,
    })).filter((p) => p.kind === "accion_vencida" || p.due === today),
    ...(plansToday.data ?? []).map((p) => ({ kind: "visita_hoy" as const, title: p.title, detail: `${p.visit_stops.length} paradas hoy`, href: `${base}/agenda/${p.id}` })),
    ...(ctx.canApprove ? (decisions.data ?? []).slice(0, 2).map((d) => ({ kind: "voto" as const, title: d.question, detail: "espera tu decisión", href: d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`, due: d.due_on })) : []),
    ...(pendingCaptures ? [{ kind: "capturas" as const, title: `Procesar ${pendingCaptures === 1 ? "1 captura" : `${pendingCaptures} capturas`} de campo`, href: `${base}/capturas` }] : []),
    ...(toReview ? [{ kind: "revision" as const, title: `Revisar ${toReview} ${toReview === 1 ? "propuesta" : "propuestas"}`, detail: "hallazgos y borradores de RELEVO AI", href: `${base}/oportunidades` }] : []),
  ];
  const priorities = pickPriorities(priorityItems, view);

  // --- Bloques ---
  const Priorities = (
    <Section title="Mis 3 prioridades de hoy">
      {priorities.length ? (
        <ol className="space-y-2">
          {priorities.map((p, i) => (
            <li key={`${p.kind}-${i}`}>
              <Link href={p.href} className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs hover:bg-muted/50">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.title}</span>
                  {p.detail && <span className={cn("block text-xs text-muted-foreground", p.kind === "accion_vencida" && "text-destructive")}>{p.detail}</span>}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <NextStep text="Nada urgente para hoy." href={`${base}/agenda`} cta="Planificar visitas" />
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

  const Inbox = (
    <Section title="Por procesar y revisar">
      <List>
        <Row
          href={`${base}/capturas`}
          title={pendingCaptures ? `${pendingCaptures} ${pendingCaptures === 1 ? "captura sin procesar" : "capturas sin procesar"}` : "Capturas al día"}
          meta={<><PhonePendingNote /> {pendingCaptures ? "" : "Todo lo capturado está subido."}</>}
        />
        <Row
          href={`${base}/oportunidades`}
          title={toReview ? `${toReview} ${toReview === 1 ? "propuesta por revisar" : "propuestas por revisar"}` : "Nada por revisar"}
          meta={`${findings.count ?? 0} hallazgos pendientes · ${drafts.count ?? 0} borradores de RELEVO AI`}
        />
      </List>
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
            {Visits}
            {Actions}
            {Inbox}
            {Decisions}
            {Changes}
            {Pulse}
          </>
        ) : (
          <>
            {Priorities}
            {Decisions}
            {Changes}
            {Inbox}
            {Actions}
            {Visits}
            {Pulse}
          </>
        )}
      </div>
    </>
  );
}
