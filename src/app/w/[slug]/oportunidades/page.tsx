import Link from "next/link";
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { opportunityRoute } from "@/domain/catalogs";
import { entityOptions, findingSelect, profileNames, sourceOptions, toFindingRow } from "@/server/findings";
import { EmptyState, PageHeader } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { FindingCard } from "@/components/oportunidades/finding-card";
import { FindingForm } from "@/components/oportunidades/finding-form";
import { createFinding, proposeCandidate } from "./actions";

export const metadata: Metadata = { title: "Hallazgos" };

const TABS = [
  { key: "pendiente_revision", label: "Por revisar" },
  { key: "aprobado", label: "Aprobados" },
  { key: "rechazado", label: "Rechazados" },
] as const;

export default async function HallazgosPage({ params, searchParams }: PageProps<"/w/[slug]/oportunidades">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();

  // Un enlace directo a un hallazgo (?h=) abre la pestaña donde está.
  let tab = TABS.find((t) => t.key === sp.estado)?.key;
  if (!tab && typeof sp.h === "string") {
    const { data } = await supabase.from("findings").select("review_status").eq("id", sp.h).maybeSingle();
    tab = (data?.review_status as (typeof TABS)[number]["key"]) ?? undefined;
  }
  tab ??= "pendiente_revision";

  const [{ data: raw }, sources, entities] = await Promise.all([
    supabase.from("findings").select(findingSelect).eq("review_status", tab).order("created_at", { ascending: false }).limit(200),
    sourceOptions(supabase),
    entityOptions(supabase),
  ]);
  const findings = (raw ?? []).map(toFindingRow);
  const names = await profileNames(supabase, findings.flatMap((f) => [f.created_by, f.reviewed_by]));

  return (
    <>
      <PageHeader
        title="Hallazgos"
        subtitle="Research → Hallazgo → Verificación → Revisión humana. Aprobar un hallazgo no crea nada solo: la oportunidad candidata se propone a mano."
      />
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`?estado=${t.key}`} className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${tab === t.key ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "aprobado" && ctx.canEdit && findings.length > 0 && (
        <details className="mb-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <summary className="cursor-pointer text-sm font-medium">Proponer oportunidad candidata con los hallazgos marcados</summary>
          <ActionForm id="candidate-form" action={proposeCandidate.bind(null, slug)} className="mt-4 max-w-xl">
            {/* Los checkboxes de cada tarjeta se suman a este formulario con form="candidate-form". */}
            <input type="hidden" name="idempotency_key" value={`candidate:${randomUUID()}`} />
            <TextField name="title" label="Título de la oportunidad" placeholder="Ej.: Lavandería industrial para campamentos" />
            <SelectField name="route" label="Vía posible" defaultValue="a_definir" options={opportunityRoute.values.map((v) => ({ value: v, label: opportunityRoute.label(v) }))} />
            <TextAreaField name="thesis" label="Tesis (qué creemos y por qué)" rows={3} />
            <p className="text-xs text-muted-foreground">
              Marcá abajo los hallazgos aprobados que la sustentan. Nace como <strong>candidata</strong>: entra al dealflow solo si alguien con capacidad de aprobar lo decide.
            </p>
            <SubmitButton>Proponer candidata</SubmitButton>
          </ActionForm>
        </details>
      )}

      {findings.length ? (
        <div className="space-y-3">
          {findings.map((f) => (
            <FindingCard key={f.id} f={f} slug={slug} canEdit={ctx.canEdit} names={names} selectableFor={tab === "aprobado" ? "candidate-form" : undefined} />
          ))}
        </div>
      ) : (
        <EmptyState title={tab === "pendiente_revision" ? "No hay hallazgos por revisar" : "Sin hallazgos en esta pestaña"}>
          Los hallazgos salen de las visitas (botón “Proponer hallazgos”) o se cargan acá desde research externo.
        </EmptyState>
      )}

      {ctx.canEdit && (
        <details className="mt-8 rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">+ Hallazgo de research externo (noticia, aviso, informe)</summary>
          <p className="mt-2 mb-4 text-xs text-muted-foreground">
            Carga manual de un ítem. Para lotes del Morning Brief (JSON o API) usá <Link href={`/w/${slug}/integraciones`} className="text-primary underline">Integraciones</Link>.
          </p>
          <FindingForm action={createFinding.bind(null, slug)} sources={sources} entities={entities} origin="research_externo" />
        </details>
      )}
    </>
  );
}
