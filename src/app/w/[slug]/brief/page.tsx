import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { briefSettings } from "@/server/brief/pipeline";
import type { BriefContent } from "@/domain/brief/contract";
import { briefDateLabel } from "@/domain/brief/render";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { EmptyState, PageHeader, Pill, Section } from "@/components/app/bits";
import { CheckboxField, TextAreaField, TextField } from "@/components/app/fields";
import { BriefView } from "@/components/brief/brief-view";
import { generateBriefNow, saveBriefSettings } from "./actions";
import { BriefStatus, type DeliveryRow } from "./status";

export const metadata: Metadata = { title: "Morning Brief" };

// El parte diario de RELEVO: el mismo objeto que reciben por email Tano, Fran y Jenny.
export default async function BriefPage({ params }: PageProps<"/w/[slug]/brief">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const isOwner = ctx.role === "owner";
  const settings = briefSettings(ctx.workspace.settings);
  const { data: briefs } = await supabase.from("briefs").select("id, brief_date, status, error, generated_at, attempts, usage, content").order("brief_date", { ascending: false }).limit(30);
  const latest = briefs?.[0];
  const ids = (briefs ?? []).map((b) => b.id);
  const { data: deliveries } = ids.length
    ? await supabase.from("brief_deliveries").select("brief_id, recipient_email, recipient_name, status, error, sent_at, last_attempt_at, provider").in("brief_id", ids)
    : { data: [] };
  const byBrief = (id: string) => (deliveries ?? []).filter((d) => d.brief_id === id) as DeliveryRow[];

  return (
    <>
      <PageHeader
        title="Morning Brief"
        subtitle="Qué cambió en Vaca Muerta / Añelo que puede importar, qué significa para nosotros y qué haría RELEVO. Un solo brief por día, guardado en la memoria y enviado igual a todos."
        actions={isOwner ? (
          <ActionForm action={generateBriefNow.bind(null, slug)} className="space-y-0"><SubmitButton variant="outline" className="h-9">Generar el de hoy ahora</SubmitButton></ActionForm>
        ) : undefined}
      />
      <div className="space-y-8">
        {latest ? (
          <>
            <BriefStatus slug={slug} brief={latest} deliveries={byBrief(latest.id)} isOwner={isOwner} link />
            {latest.status === "generado" && <BriefView slug={slug} briefId={latest.id} content={latest.content as unknown as BriefContent} canEdit={ctx.canEdit} />}
          </>
        ) : (
          <EmptyState title="Todavía no hay briefs">
            {settings.enabled ? "El primero se genera mañana temprano, o ahora con «Generar el de hoy ahora»." : "Activalo abajo con los destinatarios (owner)."}
          </EmptyState>
        )}

        {(briefs?.length ?? 0) > 1 && (
          <Section title="Anteriores">
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {briefs!.slice(1).map((b) => {
                const d = byBrief(b.id);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 p-3">
                    <Link href={`/w/${slug}/brief/${b.id}`} className="font-medium hover:underline">{briefDateLabel(b.brief_date)}</Link>
                    <Pill>{b.status}</Pill>
                    {d.length > 0 && <span className="text-xs text-muted-foreground">{d.filter((x) => x.status === "enviado").length}/{d.length} enviados</span>}
                    {b.status === "generado" && <span className="text-xs text-muted-foreground">{(b.content as unknown as BriefContent).signals?.length ?? 0} señales</span>}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {isOwner && (
          <Section title="Configuración">
            <ActionForm action={saveBriefSettings.bind(null, slug)} className="max-w-xl">
              <CheckboxField name="enabled" label="Generar y enviar el Morning Brief todos los días (≈ 5–6 h, hora Argentina)" defaultChecked={settings.enabled} />
              <TextAreaField
                name="recipients"
                label="Destinatarios"
                rows={4}
                hint="Una persona por línea: «Nombre <email>». Todos reciben exactamente el mismo brief."
                defaultValue={settings.recipients.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join("\n")}
              />
              <TextField name="monthly_cap_usd" label="Tope mensual de IA (USD)" type="number" defaultValue={String(settings.monthlyCapUsd)} hint="Si se alcanza, el brief sigue saliendo en modo reducido (sin investigación web)." />
              <SubmitButton>Guardar</SubmitButton>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
