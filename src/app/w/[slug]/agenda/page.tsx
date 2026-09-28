import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { createPlan } from "./actions";

export const metadata: Metadata = { title: "Agenda y mapa" };

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

type PlanRow = { id: string; title: string; planned_on: string; campaigns: { name: string } | null; visit_stops: { status: string }[] };

function PlanList({ slug, items }: { slug: string; items: PlanRow[] }) {
  return (
    <ul className="divide-y rounded-xl border bg-card shadow-xs">
      {items.map((p) => {
        const done = p.visit_stops.filter((s) => s.status === "realizada").length;
        return (
          <li key={p.id}>
            <Link href={`/w/${slug}/agenda/${p.id}`} className="flex items-center justify-between gap-2 p-4 hover:bg-muted/50">
              <div>
                <div className="font-medium">{p.title}</div>
                <div className="text-sm text-muted-foreground">{formatDate(p.planned_on)}{p.campaigns?.name && ` · ${p.campaigns.name}`}</div>
              </div>
              <Pill>{done}/{p.visit_stops.length} paradas realizadas</Pill>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AgendaPage({ params }: PageProps<"/w/[slug]/agenda">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const today = todayAR();
  const [{ data: plans }, { data: campaigns }] = await Promise.all([
    supabase
      .from("visit_plans")
      .select("id, title, planned_on, campaigns(name), visit_stops(status)")
      .order("planned_on", { ascending: true }),
    supabase.from("campaigns").select("id, name").in("status", ["activa", "borrador"]).order("name"),
  ]);
  const upcoming = (plans ?? []).filter((p) => p.planned_on >= today);
  const past = (plans ?? []).filter((p) => p.planned_on < today).reverse();

  return (
    <>
      <PageHeader title="Agenda y mapa" subtitle="Jornadas de campo con paradas en orden manual y salida a Google Maps." />
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Próximas</h2>
      {upcoming.length ? <PlanList slug={slug} items={upcoming} /> : <EmptyState title="No hay jornadas próximas" />}

      {ctx.canEdit && (
        <details className="mt-6 rounded-lg border p-4" open={!plans?.length}>
          <summary className="cursor-pointer text-sm font-medium">+ Nueva jornada</summary>
          <ActionForm action={createPlan.bind(null, slug)} className="mt-4 max-w-xl">
            <TextField name="title" label="Título" placeholder="Ej.: Recorrida centro de Añelo" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="planned_on" label="Fecha" type="date" defaultValue={today} />
              <SelectField name="campaign_id" label="Campaña" options={(campaigns ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="— Ninguna —" defaultValue={campaigns?.[0]?.id ?? ""} />
            </div>
            <TextAreaField name="notes" label="Notas" rows={2} />
            <SubmitButton>Crear jornada</SubmitButton>
          </ActionForm>
        </details>
      )}

      {past.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-semibold text-muted-foreground uppercase">Anteriores</h2>
          <PlanList slug={slug} items={past} />
        </>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Mapa embebido y geocodificación: no disponibles todavía (P1). Hoy cada parada abre Google Maps con su dirección registrada.
      </p>
    </>
  );
}
