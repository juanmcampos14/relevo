import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { sourceKind } from "@/domain/catalogs";
import { DemoBadge, EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { createSource } from "../actions";

export const metadata: Metadata = { title: "Fuentes" };

export default async function FuentesPage({ params }: PageProps<"/w/[slug]/explorar/fuentes">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: sources } = await supabase
    .from("sources")
    .select("id, kind, title, url, publisher, published_at, captured_at, reference, is_demo")
    .order("captured_at", { ascending: false })
    .limit(200);
  const { data: docs } = await supabase.from("context_documents").select("id, title, kind, summary, source_url, updated_at").eq("status", "vigente").order("kind").order("title");

  return (
    <>
      <PageHeader title="Fuentes" subtitle="De dónde sale cada dato. Una URL se registra una sola vez por workspace." />
      {!!docs?.length && (
        <section className="mb-6 space-y-2">
          <h2 className="text-sm font-semibold">Documentos de contexto</h2>
          <p className="text-xs text-muted-foreground">
            RELEVO los consulta para entender qué buscamos y cómo se pensó el trabajo. No son evidencia: si el campo dice otra cosa, manda el campo.
          </p>
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {docs.map((d) => (
              <li key={d.id} id={`doc-${d.id}`} className="space-y-1 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  <Pill>{d.kind === "metodologia" ? "Metodología" : "Contexto"}</Pill>
                </div>
                {d.summary && <p className="text-sm text-muted-foreground">{d.summary}</p>}
                <p className="text-xs text-muted-foreground">
                  actualizado {formatDate(d.updated_at)}
                  {d.source_url && (
                    <>
                      {" · "}
                      <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        abrir original
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sources?.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {sources.map((s) => (
            <li key={s.id} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.title}</span>
                <Pill>{sourceKind.label(s.kind)}</Pill>
                <DemoBadge show={s.is_demo} />
              </div>
              {s.url && (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-primary hover:underline">
                  {s.url}
                </a>
              )}
              <p className="text-xs text-muted-foreground">
                {[s.publisher, s.published_at && `publicado ${formatDate(s.published_at)}`, `capturado ${formatDate(s.captured_at)}`, s.reference]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No hay fuentes registradas" />
      )}
      {ctx.canEdit && (
        <details className="mt-6 rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">+ Nueva fuente</summary>
          <ActionForm action={createSource.bind(null, slug)} resetOnSuccess className="mt-4 max-w-xl">
            <SelectField name="kind" label="Tipo" options={sourceKind.values.map((v) => ({ value: v, label: sourceKind.label(v) }))} />
            <TextField name="title" label="Título" required />
            <TextField name="url" label="URL" type="url" placeholder="https://" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="publisher" label="Medio / autor" />
              <TextField name="published_at" label="Fecha de publicación" type="date" />
            </div>
            <TextField name="reference" label="Referencia" hint="Para fuentes orales u observaciones: quién lo dijo, dónde y cuándo." />
            <TextAreaField name="notes" label="Notas" rows={2} />
            <CheckboxField name="is_demo" label="Es un dato DEMO (ficticio)" />
            <SubmitButton>Registrar fuente</SubmitButton>
          </ActionForm>
        </details>
      )}
    </>
  );
}
