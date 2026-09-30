import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { taskStatus } from "@/domain/catalogs";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";

export const metadata: Metadata = { title: "Actividades" };

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

// Todas las actividades y próximas acciones: del CRM, de capturas y de validaciones de hipótesis.
export default async function ActivitiesPage({ params, searchParams }: PageProps<"/w/[slug]/explorar/actividades">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const done = sp.estado === "hechas";
  const mine = sp.de === "mias";
  let query = supabase
    .from("tasks")
    .select(`id, title, status, due_on, kind, completed_at, assignee_id, finding_id, findings(statement), contacts(id, full_name), campaign_targets(${targetEntitySelect})`)
    .limit(300);
  query = done ? query.eq("status", "done").order("completed_at", { ascending: false }) : query.neq("status", "done").order("due_on", { nullsFirst: false });
  if (mine) query = query.eq("assignee_id", ctx.user.id);
  const [{ data: tasks }, { data: profiles }] = await Promise.all([query, supabase.from("profiles").select("user_id, display_name, email")]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name || p.email]));
  const today = todayAR();
  const chip = (label: string, href: string, active: boolean) => (
    <Link key={label} href={href} className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${active ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>{label}</Link>
  );
  const qs = (estado: string | null, de: string | null) => `?${[estado && `estado=${estado}`, de && `de=${de}`].filter(Boolean).join("&")}`;

  return (
    <>
      <PageHeader title="Actividades" subtitle="Próximas acciones y actividades de toda la red: del CRM importado, de las capturas y de las validaciones de hipótesis." />
      <div className="mb-4 flex flex-wrap gap-2">
        {chip("Abiertas", qs(null, mine ? "mias" : null), !done)}
        {chip("Hechas", qs("hechas", mine ? "mias" : null), done)}
        <span className="mx-1 w-px bg-border" aria-hidden="true" />
        {chip("De todos", qs(done ? "hechas" : null, null), !mine)}
        {chip("Mías", qs(done ? "hechas" : null, "mias"), mine)}
      </div>
      {tasks?.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {tasks.map((t) => {
            const e = t.campaign_targets ? resolveTargetEntity(t.campaign_targets) : null;
            const overdue = !done && !!t.due_on && t.due_on < today;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0 space-y-0.5">
                  <div className="font-medium">{t.finding_id ? <Link href={`${base}/hallazgos/${t.finding_id}`} className="hover:underline">{t.title}</Link> : t.title}</div>
                  <div className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                    {e && <Link href={entityHref(slug, e.kind, e.id)} className="text-primary hover:underline">{e.name}</Link>}
                    {t.contacts && <Link href={`${base}/explorar/personas/${t.contacts.id}`} className="text-primary hover:underline">{t.contacts.full_name}</Link>}
                    {t.findings && <span>valida «{t.findings.statement.length > 60 ? `${t.findings.statement.slice(0, 60)}…` : t.findings.statement}»</span>}
                    {t.assignee_id && <span>· {nameOf.get(t.assignee_id) ?? "—"}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {t.kind && <Pill>{t.kind}</Pill>}
                  <span className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                    {done ? `hecha ${formatDate(t.completed_at)}` : t.due_on ? `${overdue ? "vencida " : ""}${formatDate(t.due_on)}` : taskStatus.label(t.status)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={done ? "Sin actividades hechas" : "Sin actividades abiertas"} />
      )}
    </>
  );
}
