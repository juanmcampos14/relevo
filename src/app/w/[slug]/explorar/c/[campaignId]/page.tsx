import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { campaignStatus, entityKind, assetKind, targetStatus } from "@/domain/catalogs";
import { companyName, entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { EmptyState, PageHeader, Pill, StatusBadges, formatDate, statusTone } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxGroup } from "@/components/app/fields";
import { MapsButton } from "@/components/app/maps-button";
import { TargetForm } from "@/components/explorar/target-form";
import { createTarget, updateCampaignVerticals } from "../../actions";

const priorityLabel: Record<number, string> = { 1: "Alta", 2: "Media", 3: "Baja" };

export default async function CampaignPage({ params, searchParams }: PageProps<"/w/[slug]/explorar/c/[campaignId]">) {
  const { slug, campaignId } = await params;
  const sp = await searchParams;
  const vFilter = typeof sp.v === "string" ? sp.v : "";
  const sFilter = typeof sp.estado === "string" ? sp.estado : "";
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, zone, objective, status, starts_on, ends_on, campaign_verticals(vertical_id, verticals(id, name))")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) notFound();

  const [{ data: targets }, { data: allVerticals }, { data: sources }, { data: companies }, { data: establishments }, { data: assets }] =
    await Promise.all([
      supabase
        .from("campaign_targets")
        .select(`id, status, priority, next_action, next_action_due, target_verticals(vertical_id), ${targetEntitySelect}`)
        .eq("campaign_id", campaignId)
        .order("priority")
        .order("created_at", { ascending: false }),
      supabase.from("verticals").select("id, name").eq("status", "activa").order("name"),
      supabase.from("sources").select("id, title, url").order("captured_at", { ascending: false }).limit(300),
      supabase.from("companies").select("id, trade_name, legal_name").order("trade_name"),
      supabase.from("establishments").select("id, name").order("name"),
      supabase.from("assets").select("id, title").order("title"),
    ]);

  const campaignVerticals = campaign.campaign_verticals.map((cv) => cv.verticals!).filter(Boolean);
  const verticalName = new Map((allVerticals ?? []).map((v) => [v.id, v.name]));
  const rows = (targets ?? []).map((t) => ({ ...t, entity: resolveTargetEntity(t) }));
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
  const visible = rows.filter(
    (r) => (!vFilter || r.target_verticals.some((tv) => tv.vertical_id === vFilter)) && (!sFilter || r.status === sFilter),
  );

  const inCampaign = new Set(rows.map((r) => (r.entity ? `${r.entity.kind}:${r.entity.id}` : "")));
  const existingOptions = [
    ...(companies ?? []).map((c) => ({ value: `company:${c.id}`, label: `Empresa · ${companyName(c)}` })),
    ...(establishments ?? []).map((e) => ({ value: `establishment:${e.id}`, label: `Establecimiento · ${e.name}` })),
    ...(assets ?? []).map((a) => ({ value: `asset:${a.id}`, label: `Activo · ${a.title}` })),
  ].filter((o) => !inCampaign.has(o.value));

  const href = (v: string, s: string) => {
    const q = new URLSearchParams();
    if (v) q.set("v", v);
    if (s) q.set("estado", s);
    const qs = q.toString();
    return `/w/${slug}/explorar/c/${campaignId}${qs ? `?${qs}` : ""}`;
  };
  const chip = (active: boolean) =>
    `inline-flex h-8 items-center rounded-full border px-3 text-sm whitespace-nowrap ${active ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <>
      <PageHeader
        back={<Link href={`/w/${slug}/explorar`} className="hover:underline">← Campañas</Link>}
        title={campaign.name}
        subtitle={[campaignStatus.label(campaign.status), campaign.zone, campaign.starts_on && `${formatDate(campaign.starts_on)} → ${formatDate(campaign.ends_on)}`]
          .filter(Boolean)
          .join(" · ")}
      />
      {campaign.objective && <p className="-mt-3 mb-5 max-w-2xl text-sm">{campaign.objective}</p>}

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar por vertical">
        <Link href={href("", sFilter)} className={chip(!vFilter)}>Todas las verticales</Link>
        {campaignVerticals.map((v) => (
          <Link key={v.id} href={href(v.id, sFilter)} className={chip(vFilter === v.id)}>{v.name}</Link>
        ))}
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar por estado">
        <Link href={href(vFilter, "")} className={chip(!sFilter)}>Todos ({rows.length})</Link>
        {targetStatus.values
          .filter((s) => counts.get(s))
          .map((s) => (
            <Link key={s} href={href(vFilter, s)} className={chip(sFilter === s)}>
              {targetStatus.label(s)} ({counts.get(s)})
            </Link>
          ))}
      </div>

      {visible.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {visible.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {t.entity ? (
                    <Link href={entityHref(slug, t.entity.kind, t.entity.id)} className="font-medium hover:underline">{t.entity.name}</Link>
                  ) : (
                    <span className="font-medium">(registro no disponible)</span>
                  )}
                  {t.entity && <Pill>{t.entity.subtype ? assetKind.label(t.entity.subtype) : entityKind.label(t.entity.kind)}</Pill>}
                  {t.entity && <StatusBadges verification={t.entity.verification} isDemo={t.entity.isDemo} />}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <Pill className={statusTone(t.status)}>{targetStatus.label(t.status)}</Pill>
                  prioridad {priorityLabel[t.priority]}
                  {t.next_action && ` · ${t.next_action}`}
                  {t.next_action_due && ` (${formatDate(t.next_action_due)})`}
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.target_verticals.map((tv) => (
                    <Pill key={tv.vertical_id}>{verticalName.get(tv.vertical_id)}</Pill>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <MapsButton place={t.entity?.place ?? null} compact />
                {ctx.canEdit && (
                  <Link href={`/w/${slug}/agenda/visita?target=${t.id}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">
                    Registrar visita
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={rows.length ? "Ningún objetivo con estos filtros" : "Esta campaña todavía no tiene objetivos"}>
          {!rows.length && "Agregá el primero abajo: empresa, establecimiento o activo."}
        </EmptyState>
      )}

      {ctx.canEdit && (
        <div className="mt-8 space-y-4">
          <details className="rounded-lg border p-4" open={!rows.length}>
            <summary className="cursor-pointer text-sm font-medium">+ Agregar objetivo</summary>
            <div className="mt-4">
              <TargetForm
                action={createTarget.bind(null, slug, campaignId)}
                verticals={campaignVerticals.map((v) => ({ value: v.id, label: v.name }))}
                sources={(sources ?? []).map((s) => ({ value: s.id, label: s.url ? `${s.title} — ${new URL(s.url).hostname}` : s.title }))}
                companies={(companies ?? []).map((c) => ({ value: c.id, label: companyName(c) }))}
                existing={existingOptions}
                defaultVerticalId={vFilter || undefined}
              />
            </div>
          </details>
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">Verticales de la campaña</summary>
            <ActionForm action={updateCampaignVerticals.bind(null, slug, campaignId)} className="mt-4">
              <CheckboxGroup
                name="vertical_ids"
                label="Incluidas"
                options={(allVerticals ?? []).map((v) => ({ value: v.id, label: v.name }))}
                defaultValues={campaignVerticals.map((v) => v.id)}
              />
              <p className="text-xs text-muted-foreground">
                ¿Falta una? Creala en <Link href={`/w/${slug}/explorar/verticales`} className="underline">Verticales</Link>.
              </p>
              <SubmitButton variant="outline">Guardar verticales</SubmitButton>
            </ActionForm>
          </details>
        </div>
      )}
    </>
  );
}
