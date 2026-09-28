import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { targetStatus } from "@/domain/catalogs";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { EmptyState, NotAvailable, PageHeader, Pill, Section, formatDate } from "@/components/app/bits";

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

// Corte A: inicio común con datos reales. Los inicios personalizados de Tano y Fran
// (preferencias por usuario, sin tocar permisos) llegan en el Corte B.
export default async function HomePage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const today = todayAR();

  const [{ data: profile }, { data: plans }, { data: actions }, { data: recentVisits }, { data: statusRows }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    supabase
      .from("visit_plans")
      .select("id, title, planned_on, visit_stops(status)")
      .gte("planned_on", today)
      .order("planned_on")
      .limit(5),
    supabase
      .from("campaign_targets")
      .select(`id, next_action, next_action_due, status, ${targetEntitySelect}`)
      .not("next_action", "is", null)
      .not("status", "eq", "descartado")
      .order("next_action_due", { ascending: true, nullsFirst: false })
      .order("priority")
      .limit(8),
    supabase
      .from("visits")
      .select(`id, visited_at, campaign_targets(${targetEntitySelect})`)
      .order("visited_at", { ascending: false })
      .limit(5),
    supabase.from("campaign_targets").select("status"),
  ]);

  const counts = new Map<string, number>();
  (statusRows ?? []).forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));

  return (
    <>
      <PageHeader title={`Hola, ${profile?.display_name || ctx.user.email}`} subtitle={`${ctx.workspace.name} · ${formatDate(today)}`} />
      <div className="mb-8 flex flex-wrap gap-2">
        {(statusRows?.length ?? 0) === 0 ? (
          <Pill>Sin objetivos registrados</Pill>
        ) : (
          targetStatus.values
            .filter((s) => counts.get(s))
            .map((s) => <Pill key={s}>{targetStatus.label(s)}: {counts.get(s)}</Pill>)
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Próximas jornadas" actions={<Link href={`/w/${slug}/agenda`} className="text-sm text-primary hover:underline">Agenda</Link>}>
          {plans?.length ? (
            <ul className="divide-y rounded-lg border">
              {plans.map((p) => (
                <li key={p.id}>
                  <Link href={`/w/${slug}/agenda/${p.id}`} className="flex justify-between gap-2 p-3 text-sm hover:bg-muted/50">
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

        <Section title="Próximas acciones">
          {actions?.length ? (
            <ul className="divide-y rounded-lg border">
              {actions.map((a) => {
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

        <Section title="Últimas visitas">
          {recentVisits?.length ? (
            <ul className="divide-y rounded-lg border">
              {recentVisits.map((v) => {
                const e = v.campaign_targets ? resolveTargetEntity(v.campaign_targets) : null;
                return (
                  <li key={v.id}>
                    <Link href={`/w/${slug}/agenda/visita/${v.id}`} className="block p-3 text-sm hover:bg-muted/50">
                      <span className="font-medium">{e?.name ?? "—"}</span> · {formatDate(v.visited_at, true)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Sin visitas registradas" />
          )}
        </Section>

        <Section title="Revisión y decisiones">
          <NotAvailable what="Hallazgos por revisar y decisiones pendientes" when="Llegan en el Corte B (5/10)." />
        </Section>
      </div>
    </>
  );
}
