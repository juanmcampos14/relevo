import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { campaignStatus } from "@/domain/catalogs";
import { EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxGroup, SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { createCampaign } from "./actions";

export const metadata: Metadata = { title: "Explorar" };

export default async function ExplorarPage({ params }: PageProps<"/w/[slug]/explorar">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const [{ data: campaigns }, { data: verticals }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, zone, status, starts_on, ends_on, campaign_verticals(verticals(name)), campaign_targets(count)")
      .order("created_at", { ascending: false }),
    supabase.from("verticals").select("id, name").eq("status", "activa").order("name"),
  ]);

  return (
    <>
      <PageHeader title="Campañas" subtitle="Campaña → vertical → objetivos. Elegí una para ver sus objetivos." />
      <div className="grid gap-3 sm:grid-cols-2">
        {campaigns?.length ? (
          campaigns.map((c) => (
            <Link key={c.id} href={`/w/${slug}/explorar/c/${c.id}`} className="rounded-lg border p-4 hover:bg-muted/50">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{c.name}</div>
                <Pill>{campaignStatus.label(c.status)}</Pill>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {[c.zone, c.starts_on && `${formatDate(c.starts_on)} → ${formatDate(c.ends_on)}`].filter(Boolean).join(" · ") || "Sin zona ni fechas"}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {c.campaign_verticals.map((cv, i) => (
                  <Pill key={i}>{cv.verticals?.name}</Pill>
                ))}
              </div>
              <div className="mt-3 text-sm">{c.campaign_targets[0]?.count ?? 0} objetivos</div>
            </Link>
          ))
        ) : (
          <EmptyState title="Todavía no hay campañas">Creá la primera abajo.</EmptyState>
        )}
      </div>

      {ctx.canEdit && (
        <details className="mt-8 rounded-lg border p-4 open:bg-muted/20">
          <summary className="cursor-pointer text-sm font-medium">+ Nueva campaña</summary>
          <ActionForm action={createCampaign.bind(null, slug)} className="mt-4 max-w-xl">
            <TextField name="name" label="Nombre" placeholder="Añelo — Discovery 2026" required />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="zone" label="Zona" placeholder="Añelo, Neuquén" />
              <SelectField name="status" label="Estado" defaultValue="activa" options={campaignStatus.values.map((v) => ({ value: v, label: campaignStatus.label(v) }))} />
              <TextField name="starts_on" label="Desde" type="date" />
              <TextField name="ends_on" label="Hasta" type="date" />
            </div>
            <TextAreaField name="objective" label="Objetivo" rows={2} />
            <CheckboxGroup name="vertical_ids" label="Verticales" options={(verticals ?? []).map((v) => ({ value: v.id, label: v.name }))} />
            <SubmitButton>Crear campaña</SubmitButton>
          </ActionForm>
        </details>
      )}
    </>
  );
}
