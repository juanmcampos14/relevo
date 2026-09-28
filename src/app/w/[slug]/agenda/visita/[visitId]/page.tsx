import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { consentStatus } from "@/domain/catalogs";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { DemoBadge, NotAvailable, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextAreaField } from "@/components/app/fields";
import { updateVisitNotes } from "../../actions";

export default async function VisitPage({ params, searchParams }: PageProps<"/w/[slug]/agenda/visita/[visitId]">) {
  const { slug, visitId } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: visit } = await supabase
    .from("visits")
    .select(`id, visited_at, interlocutor_name, consent_status, notes, is_demo, created_at, created_by, stop_id,
             contacts(full_name, role_title), visit_stops(plan_id), campaign_targets(id, campaigns(name), ${targetEntitySelect})`)
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) notFound();
  const entity = visit.campaign_targets ? resolveTargetEntity(visit.campaign_targets) : null;
  const { data: author } = visit.created_by
    ? await supabase.from("profiles").select("display_name, email").eq("user_id", visit.created_by).maybeSingle()
    : { data: null };

  return (
    <>
      <PageHeader
        back={
          visit.visit_stops?.plan_id ? (
            <Link href={`/w/${slug}/agenda/${visit.visit_stops.plan_id}`} className="hover:underline">← Jornada</Link>
          ) : entity ? (
            <Link href={entityHref(slug, entity.kind, entity.id)} className="hover:underline">← {entity.name}</Link>
          ) : null
        }
        title={<span className="flex items-center gap-2">Visita a {entity?.name ?? "—"}<DemoBadge show={visit.is_demo} /></span>}
        subtitle={[formatDate(visit.visited_at, true), visit.campaign_targets?.campaigns?.name, `registrada por ${author?.display_name || author?.email || "—"}`].filter(Boolean).join(" · ")}
      />
      {sp.nueva && <p className="mb-4 rounded-md bg-primary/10 p-3 text-sm text-primary">Visita guardada. El objetivo quedó como “Visitado”.</p>}
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {visit.interlocutor_name && <Pill>Con: {visit.interlocutor_name}</Pill>}
        {visit.contacts && <Pill>Contacto: {visit.contacts.full_name}</Pill>}
        <Pill>Consentimiento: {consentStatus.label(visit.consent_status)}</Pill>
        {entity && <Link href={entityHref(slug, entity.kind, entity.id)} className="text-primary hover:underline">Ver ficha</Link>}
      </div>
      {ctx.canEdit ? (
        <ActionForm action={updateVisitNotes.bind(null, slug, visitId)} className="max-w-2xl">
          <TextAreaField name="notes" label="Notas" rows={12} defaultValue={visit.notes} />
          <SubmitButton variant="outline">Guardar notas</SubmitButton>
        </ActionForm>
      ) : (
        <p className="max-w-2xl text-sm whitespace-pre-wrap">{visit.notes}</p>
      )}
      <div className="mt-8 max-w-2xl">
        <NotAvailable what="Hallazgos y revisión" when="Llega en el Corte B (5/10): convertir estas notas en hallazgos revisables." />
      </div>
    </>
  );
}
