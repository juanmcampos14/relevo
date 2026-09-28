import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { profileNames } from "@/server/findings";
import { EmptyState, PageHeader, Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { SelectField } from "@/components/app/fields";
import { generateBriefing } from "../actions";

export const metadata: Metadata = { title: "Briefings" };

export default async function BriefingsPage({ params }: PageProps<"/w/[slug]/oportunidades/briefings">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("briefings")
    .select("id, title, scope, audience_user_id, status, created_at, created_by, published_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const names = await profileNames(supabase, (rows ?? []).flatMap((b) => [b.created_by, b.audience_user_id]));

  return (
    <>
      <PageHeader title="Briefings" subtitle="Armados a partir de los registros, con enlaces a cada uno. Se comparten dentro de la app; no se envían por email ni WhatsApp." />
      {ctx.canEdit && (
        <ActionForm action={generateBriefing.bind(null, slug)} className="mb-6 flex flex-wrap items-end gap-3 space-y-0 rounded-lg border p-4">
          <SelectField name="scope" label="Tipo" className="w-48" defaultValue="conjunto" options={[{ value: "conjunto", label: "Conjunto (workspace)" }, { value: "personal", label: "Personal (lo mío primero)" }]} />
          <SelectField name="days" label="Periodo" className="w-40" defaultValue="7" options={[{ value: "1", label: "Último día" }, { value: "7", label: "Últimos 7 días" }, { value: "14", label: "Últimos 14 días" }, { value: "30", label: "Últimos 30 días" }]} />
          <SubmitButton>Generar briefing</SubmitButton>
        </ActionForm>
      )}
      {rows?.length ? (
        <ul className="divide-y rounded-lg border">
          {rows.map((b) => (
            <li key={b.id}>
              <Link href={`/w/${slug}/oportunidades/briefings/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/50">
                <div>
                  <div className="font-medium">{b.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(b.created_at, true)} · por {names.get(b.created_by ?? "") ?? "—"}
                    {b.scope === "personal" && ` · para ${names.get(b.audience_user_id ?? "") ?? "—"}`}
                  </div>
                </div>
                <Pill className={b.status === "publicado_en_app" ? "border-primary text-primary" : ""}>{b.status === "publicado_en_app" ? "Publicado en la app" : "Borrador"}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Todavía no hay briefings" />
      )}
    </>
  );
}
