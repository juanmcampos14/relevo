import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { EmptyState, PageHeader } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextAreaField, TextField } from "@/components/app/fields";
import { createVertical } from "../actions";

export const metadata: Metadata = { title: "Verticales" };

export default async function VerticalesPage({ params }: PageProps<"/w/[slug]/explorar/verticales">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: verticals } = await supabase
    .from("verticals")
    .select("id, name, thesis, problem_sought, target_verticals(count)")
    .order("name");

  return (
    <>
      <PageHeader title="Verticales" subtitle="Categorías configurables. Un mismo objetivo puede estar en varias." />
      {verticals?.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {verticals.map((v) => (
            <li key={v.id} className="p-4">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{v.name}</span>
                <span className="text-sm text-muted-foreground">{v.target_verticals[0]?.count ?? 0} objetivos</span>
              </div>
              {v.thesis && <p className="mt-1 text-sm text-muted-foreground">Tesis: {v.thesis}</p>}
              {v.problem_sought && <p className="text-sm text-muted-foreground">Problema buscado: {v.problem_sought}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No hay verticales" />
      )}
      {ctx.canEdit && (
        <details className="mt-6 rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">+ Nueva vertical</summary>
          <ActionForm action={createVertical.bind(null, slug)} resetOnSuccess className="mt-4 max-w-xl">
            <TextField name="name" label="Nombre" required />
            <TextAreaField name="thesis" label="Tesis / hipótesis" rows={2} />
            <TextAreaField name="problem_sought" label="Problema que buscamos" rows={2} />
            <SubmitButton>Crear vertical</SubmitButton>
          </ActionForm>
        </details>
      )}
    </>
  );
}
