import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dealflowStage, findingKind, taskStatus } from "@/domain/catalogs";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { EmptyState, PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { setHomeView } from "./home-actions";

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

const linkCls = "text-sm text-primary hover:underline";

// Dos inicios sobre los MISMOS datos. La vista es una preferencia personal:
// Fran (ejecutiva) y Tano (operativa) conservan acceso completo a todo.
export default async function HomePage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const today = todayAR();
  const base = `/w/${slug}`;

  const [{ data: profile }, { data: pref }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    supabase.from("user_preferences").select("home").eq("user_id", ctx.user.id).eq("workspace_id", ctx.workspace.id).maybeSingle(),
  ]);
  const stored = (pref?.home as { view?: string } | null)?.view;
  const view: "operativa" | "ejecutiva" = stored === "ejecutiva" || stored === "operativa" ? stored : ctx.role === "admin" ? "ejecutiva" : "operativa";
  const other = view === "operativa" ? "ejecutiva" : "operativa";

  const [pendingFindings, myTasks, plans, actions, pendingDecisions, candidates, dealflow, lastBriefing, recentApproved] = await Promise.all([
    supabase.from("findings").select("id, kind, statement, created_at", { count: "exact" }).eq("review_status", "pendiente_revision").order("created_at", { ascending: false }).limit(4),
    supabase.from("tasks").select("id, title, status, due_on, opportunity_id").eq("assignee_id", ctx.user.id).neq("status", "done").order("due_on", { nullsFirst: false }).limit(6),
    supabase.from("visit_plans").select("id, title, planned_on, visit_stops(status)").gte("planned_on", today).order("planned_on").limit(4),
    supabase
      .from("campaign_targets")
      .select(`id, next_action, next_action_due, ${targetEntitySelect}`)
      .not("next_action", "is", null)
      .neq("status", "descartado")
      .order("next_action_due", { ascending: true, nullsFirst: false })
      .limit(6),
    supabase.from("decisions").select("id, question, due_on, opportunity_id, opportunities(title)").eq("status", "requested").order("created_at").limit(6),
    supabase.from("opportunities").select("id, title, created_at").eq("status", "candidata").order("created_at", { ascending: false }).limit(5),
    supabase.from("opportunities").select("stage").eq("status", "aprobada"),
    supabase.from("briefings").select("id, title, published_at").eq("status", "publicado_en_app").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("findings").select("id, kind, statement, reviewed_at").eq("review_status", "aprobado").order("reviewed_at", { ascending: false }).limit(5),
  ]);

  const stageCounts = new Map<string, number>();
  (dealflow.data ?? []).forEach((o) => o.stage && stageCounts.set(o.stage, (stageCounts.get(o.stage) ?? 0) + 1));

  const Decisions = (
    <Section title={`Decisiones pendientes (${pendingDecisions.data?.length ?? 0})`} actions={<Link href={`${base}/oportunidades/decisiones`} className={linkCls}>Ver todas</Link>}>
      {pendingDecisions.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {pendingDecisions.data.map((d) => (
            <li key={d.id}>
              <Link href={d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`} className="block p-3 text-sm hover:bg-muted/50">
                <span className="font-medium">{d.question}</span>
                {d.opportunities?.title && <span className="text-muted-foreground"> · {d.opportunities.title}</span>}
                {d.due_on && <span className={`text-xs ${d.due_on < today ? "text-destructive" : "text-muted-foreground"}`}> · vence {formatDate(d.due_on)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Sin decisiones pendientes" />
      )}
    </Section>
  );

  const Review = (
    <Section title={`Hallazgos por revisar (${pendingFindings.count ?? 0})`} actions={<Link href={`${base}/oportunidades`} className={linkCls}>Revisar</Link>}>
      {pendingFindings.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {pendingFindings.data.map((f) => (
            <li key={f.id}>
              <Link href={`${base}/oportunidades?h=${f.id}#h-${f.id}`} className="block p-3 text-sm hover:bg-muted/50">
                <span className="text-muted-foreground">{findingKind.label(f.kind)}:</span> {f.statement}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nada por revisar" />
      )}
    </Section>
  );

  const Tasks = (
    <Section title="Mis tareas">
      {myTasks.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {myTasks.data.map((t) => (
            <li key={t.id} className="p-3 text-sm">
              {t.opportunity_id ? <Link href={`${base}/oportunidades/o/${t.opportunity_id}`} className="hover:underline">{t.title}</Link> : t.title}
              <div className="text-xs text-muted-foreground">
                {taskStatus.label(t.status)}
                {t.due_on && <span className={t.due_on < today ? " text-destructive" : ""}> · vence {formatDate(t.due_on)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Sin tareas asignadas" />
      )}
    </Section>
  );

  const Plans = (
    <Section title="Próximas jornadas" actions={<Link href={`${base}/agenda`} className={linkCls}>Agenda</Link>}>
      {plans.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {plans.data.map((p) => (
            <li key={p.id}>
              <Link href={`${base}/agenda/${p.id}`} className="flex justify-between gap-2 p-3 text-sm hover:bg-muted/50">
                <span><span className="font-medium">{p.title}</span> · {formatDate(p.planned_on)}</span>
                <span className="text-muted-foreground">{p.visit_stops.length} paradas</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Sin jornadas próximas" />
      )}
    </Section>
  );

  const Actions = (
    <Section title="Próximas acciones">
      {actions.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {actions.data.map((a) => {
            const e = resolveTargetEntity(a);
            const overdue = a.next_action_due && a.next_action_due < today;
            return (
              <li key={a.id} className="p-3 text-sm">
                {e && <Link href={entityHref(slug, e.kind, e.id)} className="font-medium hover:underline">{e.name}</Link>}
                <div className="text-muted-foreground">
                  {a.next_action}
                  {a.next_action_due && <span className={overdue ? " font-medium text-destructive" : ""}> · {overdue ? "vencida " : ""}{formatDate(a.next_action_due)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="Sin próximas acciones registradas" />
      )}
    </Section>
  );

  const Pipeline = (
    <Section title="Oportunidades" actions={<Link href={`${base}/oportunidades/dealflow`} className={linkCls}>Dealflow</Link>}>
      <div className="flex flex-wrap gap-2">
        <Link href={`${base}/oportunidades/candidatas`}><Pill>Candidatas: {candidates.data?.length ?? 0}</Pill></Link>
        {[...stageCounts].map(([s, n]) => <Pill key={s}>{dealflowStage.label(s)}: {n}</Pill>)}
        {stageCounts.size === 0 && <Pill>Sin oportunidades aprobadas</Pill>}
      </div>
      {candidates.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {candidates.data.map((o) => (
            <li key={o.id}><Link href={`${base}/oportunidades/o/${o.id}`} className="block p-3 text-sm hover:bg-muted/50">{o.title} <span className="text-muted-foreground">· candidata</span></Link></li>
          ))}
        </ul>
      ) : null}
    </Section>
  );

  const Briefing = (
    <Section title="Último briefing" actions={<Link href={`${base}/oportunidades/briefings`} className={linkCls}>Generar el mío</Link>}>
      {lastBriefing.data ? (
        <Link href={`${base}/oportunidades/briefings/${lastBriefing.data.id}`} className="block rounded-lg border p-3 text-sm hover:bg-muted/50">
          {lastBriefing.data.title} <span className="text-muted-foreground">· publicado {formatDate(lastBriefing.data.published_at)}</span>
        </Link>
      ) : (
        <EmptyState title="Todavía no hay briefings publicados" />
      )}
    </Section>
  );

  const Approved = (
    <Section title="Hallazgos aprobados recientes">
      {recentApproved.data?.length ? (
        <ul className="divide-y rounded-lg border">
          {recentApproved.data.map((f) => (
            <li key={f.id}><Link href={`${base}/oportunidades?h=${f.id}#h-${f.id}`} className="block p-3 text-sm hover:bg-muted/50"><span className="text-muted-foreground">{findingKind.label(f.kind)}:</span> {f.statement}</Link></li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Sin hallazgos aprobados" />
      )}
    </Section>
  );

  return (
    <>
      <PageHeader
        title={`Hola, ${profile?.display_name || ctx.user.email}`}
        subtitle={`${ctx.workspace.name} · ${formatDate(today)} · inicio ${view}`}
        actions={
          <form action={setHomeView.bind(null, slug, other)}>
            <button className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted">Ver inicio {other}</button>
          </form>
        }
      />
      {view === "operativa" ? (
        <div className="grid gap-8 lg:grid-cols-2">
          {Review}
          {Tasks}
          {Plans}
          {Actions}
          {Decisions}
          {Pipeline}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          {Decisions}
          {Pipeline}
          {Briefing}
          {Approved}
          {Review}
          {Plans}
        </div>
      )}
      <p className="mt-8 text-xs text-muted-foreground">
        El inicio es una preferencia personal: no restringe el acceso. Todo el workspace está disponible desde Explorar, Agenda y Oportunidades.
      </p>
    </>
  );
}
