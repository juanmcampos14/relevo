import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { consentStatus } from "@/domain/catalogs";
import { entityFk, entityHref, resolveTargetEntity, targetEntitySelect } from "@/server/entities";
import { DemoBadge, PageHeader } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { MapsButton } from "@/components/app/maps-button";
import { createVisit } from "../actions";

export const metadata: Metadata = { title: "Registrar visita" };

function nowLocalAR() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function NewVisitPage({ params, searchParams }: PageProps<"/w/[slug]/agenda/visita">) {
  const { slug } = await params;
  const sp = await searchParams;
  const targetId = typeof sp.target === "string" ? sp.target : "";
  const stopId = typeof sp.stop === "string" ? sp.stop : "";
  const ctx = await getWorkspaceContext(slug);
  if (!targetId) notFound();
  const supabase = await createClient();

  const { data: target } = await supabase
    .from("campaign_targets")
    .select(`id, campaigns(name), ${targetEntitySelect}`)
    .eq("id", targetId)
    .maybeSingle();
  if (!target) notFound();
  const entity = resolveTargetEntity(target);
  const { data: links } = entity
    ? await supabase.from("contact_links").select("contacts(id, full_name, role_title)").eq(entityFk[entity.kind], entity.id)
    : { data: [] };

  if (!ctx.canEdit) {
    return <p className="text-sm">Tu rol es de solo lectura: no podés registrar visitas.</p>;
  }

  return (
    <>
      <PageHeader
        back={entity && <Link href={entityHref(slug, entity.kind, entity.id)} className="hover:underline">← {entity.name}</Link>}
        title="Registrar visita"
        subtitle={<span className="flex flex-wrap items-center gap-2">{entity?.name} · {target.campaigns?.name}<DemoBadge show={!!entity?.isDemo} /></span>}
        actions={<MapsButton place={entity?.place ?? null} compact />}
      />
      <p className="mb-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
        Grabación y transcripción de audio: no disponibles todavía (P1). Registrá notas escritas o dictadas con el teclado del teléfono.
      </p>
      <ActionForm action={createVisit.bind(null, slug)} className="max-w-2xl">
        <input type="hidden" name="target_id" value={targetId} />
        <input type="hidden" name="stop_id" value={stopId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="visited_at" label="Fecha y hora" type="datetime-local" defaultValue={nowLocalAR()} />
          <TextField name="interlocutor_name" label="Con quién hablaste" placeholder="Nombre o rol (ej.: encargado de turno)" />
          <SelectField
            name="contact_id"
            label="Contacto registrado (opcional)"
            placeholder="— Ninguno —"
            options={(links ?? []).flatMap((l) => (l.contacts ? [{ value: l.contacts.id, label: [l.contacts.full_name, l.contacts.role_title].filter(Boolean).join(" · ") }] : []))}
          />
          <SelectField
            name="consent_status"
            label="Consentimiento para registrar lo conversado"
            defaultValue="no_registrado"
            options={consentStatus.values.map((v) => ({ value: v, label: consentStatus.label(v) }))}
          />
        </div>
        <TextAreaField
          name="notes"
          label="Notas de la visita"
          rows={10}
          placeholder={"Qué viste, qué te dijeron (distinguí lo dicho de lo observado), necesidades, cifras mencionadas, próximos pasos."}
          hint="Lo que te dijeron es una declaración, no un hecho verificado. Los hallazgos se revisan después (Corte B)."
        />
        <CheckboxField name="is_demo" label="Es una visita DEMO (ficticia)" />
        <SubmitButton className="w-full sm:w-auto">Guardar visita</SubmitButton>
      </ActionForm>
    </>
  );
}
