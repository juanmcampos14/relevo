import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Route, TriangleAlert, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { addressStatus, stopStatus } from "@/domain/catalogs";
import { multiStopLink } from "@/domain/maps";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { DemoBadge, EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { SelectField, TextField } from "@/components/app/fields";
import { MapsButton } from "@/components/app/maps-button";
import { addStop, moveStop, removeStop, setStopStatus } from "../actions";
import { STOP_KIND_LABEL, stopPending, stopTitle, type StopKind, type StopStatus } from "@/domain/stops";

export default async function PlanPage({ params }: PageProps<"/w/[slug]/agenda/[planId]">) {
  const { slug, planId } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("visit_plans")
    .select("id, title, planned_on, notes, campaign_id, campaigns(name)")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) notFound();

  const [{ data: stops }, { data: candidates }] = await Promise.all([
    supabase
      .from("visit_stops")
      .select(`id, position, target_time, status, target_id, kind, label, time_slot, objective, key_question, outcome, contacts(id, full_name), visits(id), campaign_targets(id, status, ${targetEntitySelect})`)
      .eq("plan_id", planId)
      .order("position"),
    (() => {
      let q = supabase
        .from("campaign_targets")
        .select(`id, status, campaigns(name), ${targetEntitySelect}`)
        .neq("status", "descartado")
        .order("priority");
      if (plan.campaign_id) q = q.eq("campaign_id", plan.campaign_id);
      return q;
    })(),
  ]);

  const rows = (stops ?? []).map((s) => ({ ...s, entity: s.campaign_targets ? resolveTargetEntity(s.campaign_targets) : null }));
  const inPlan = new Set(rows.map((r) => r.target_id));
  const options = (candidates ?? [])
    .filter((c) => !inPlan.has(c.id))
    .map((c) => {
      const e = resolveTargetEntity(c);
      const addr = e?.place ? (e.place.address_status === "sin_direccion" ? " · sin dirección" : "") : "";
      return { value: c.id, label: `${e?.name ?? "?"}${addr}${plan.campaign_id ? "" : ` (${c.campaigns?.name})`}` };
    });

  const pending = rows.filter((r) => stopPending(r.status as StopStatus));
  const route = multiStopLink(pending.map((r) => r.entity?.place).filter((p) => p != null));

  return (
    <>
      <PageHeader
        back={<Link href={`/w/${slug}/agenda`} className="hover:underline">← Agenda</Link>}
        title={plan.title}
        subtitle={[formatDate(plan.planned_on), plan.campaigns?.name].filter(Boolean).join(" · ")}
        actions={
          route.kind === "ok" ? (
            <a href={route.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">
              <Route className="size-4" /> Abrir recorrido en Maps
            </a>
          ) : null
        }
      />
      {plan.notes && <p className="-mt-3 mb-4 text-sm whitespace-pre-wrap">{plan.notes}</p>}
      <div className="mb-4 space-y-1 text-xs text-muted-foreground">
        <p>El recorrido respeta el orden manual de las paradas pendientes. No es una ruta optimizada.</p>
        {route.kind === "ok" && route.unverifiedCount > 0 && (
          <p className="flex items-center gap-1 text-amber-700"><TriangleAlert className="size-3.5" /> {route.unverifiedCount} parada(s) con dirección sin verificar.</p>
        )}
        {route.kind === "ok" && route.skipped > 0 && <p>{route.skipped} parada(s) sin dirección quedaron fuera del recorrido.</p>}
        {route.kind === "none" && pending.length > 0 && <p>{route.reason}.</p>}
      </div>

      {rows.length ? (
        <ol className="space-y-3">
          {rows.map((s, i) => (
            <li key={s.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">{i + 1}</span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.entity ? (
                        <Link href={entityHref(slug, s.entity.kind, s.entity.id)} className="font-medium hover:underline">{s.entity.name}</Link>
                      ) : (
                        <span className="font-medium">{stopTitle({ kind: s.kind as StopKind, label: s.label }, s.contacts?.full_name)}</span>
                      )}
                      {s.kind !== "empresa" && <Pill>{STOP_KIND_LABEL[s.kind as StopKind]}</Pill>}
                      <Pill>{stopStatus.label(s.status)}</Pill>
                      {s.target_time ? <Pill>{s.target_time.slice(0, 5)} h</Pill> : s.time_slot ? <Pill>{s.time_slot}</Pill> : null}
                      <DemoBadge show={!!s.entity?.isDemo} />
                    </div>
                    {s.entity?.place ? (
                      <p className="text-sm text-muted-foreground">
                        {[s.entity.place.address_text, s.entity.place.locality].filter(Boolean).join(", ") || "Sin dirección"} · {addressStatus.label(s.entity.place.address_status)}
                      </p>
                    ) : s.kind === "empresa" ? (
                      <p className="text-sm text-muted-foreground">Empresa sin ubicación: agregá un establecimiento para navegar.</p>
                    ) : null}
                    {s.objective && <p className="text-sm"><span className="text-muted-foreground">Para qué:</span> {s.objective}</p>}
                    {s.key_question && <p className="text-sm"><span className="text-muted-foreground">Pregunta clave:</span> {s.key_question}</p>}
                    {s.outcome && <p className="text-sm"><span className="text-muted-foreground">Qué pasó:</span> {s.outcome}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <MapsButton place={s.entity?.place ?? null} compact />
                  {ctx.canEdit && s.visits.length === 0 && s.target_id && (
                    <Link href={`/w/${slug}/agenda/visita?target=${s.target_id}&stop=${s.id}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">
                      Registrar visita
                    </Link>
                  )}
                  {s.visits[0] && (
                    <Link href={`/w/${slug}/agenda/visita/${s.visits[0].id}`} className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted">Ver visita</Link>
                  )}
                </div>
              </div>
              {ctx.canEdit && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <ActionForm action={setStopStatus.bind(null, slug, planId, s.id)} className="flex items-end gap-2 space-y-0">
                    <SelectField name="status" label="Estado" className="w-44" defaultValue={s.status} options={stopStatus.values.map((v) => ({ value: v, label: stopStatus.label(v) }))} />
                    <SubmitButton variant="outline">OK</SubmitButton>
                  </ActionForm>
                  <div className="ml-auto flex gap-1">
                    <form action={moveStop.bind(null, slug, planId, s.id, "up")}>
                      <button aria-label="Subir" disabled={i === 0} className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ArrowUp className="size-4" /></button>
                    </form>
                    <form action={moveStop.bind(null, slug, planId, s.id, "down")}>
                      <button aria-label="Bajar" disabled={i === rows.length - 1} className="inline-flex size-9 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ArrowDown className="size-4" /></button>
                    </form>
                    {s.visits.length === 0 && (
                      <form action={removeStop.bind(null, slug, planId, s.id)}>
                        <button aria-label="Quitar de la jornada" className="inline-flex size-9 items-center justify-center rounded-md border text-destructive hover:bg-destructive/10"><X className="size-4" /></button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="La jornada no tiene paradas">Agregá objetivos de la campaña abajo.</EmptyState>
      )}

      {ctx.canEdit && (
        <details className="mt-6 rounded-lg border p-4" open>
          <summary className="cursor-pointer text-sm font-medium">+ Agregar parada</summary>
          <ActionForm action={addStop.bind(null, slug, planId)} resetOnSuccess className="mt-4 max-w-xl">
            <SelectField name="target_id" label="Objetivo" options={options} placeholder={options.length ? "— Elegir —" : "No quedan objetivos para agregar"} />
            <TextField name="target_time" label="Hora estimada (opcional)" type="time" />
            <SubmitButton>Agregar</SubmitButton>
          </ActionForm>
        </details>
      )}
    </>
  );
}
