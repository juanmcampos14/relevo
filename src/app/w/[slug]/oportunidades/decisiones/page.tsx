import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { profileNames } from "@/server/findings";
import { EmptyState, PageHeader, Section } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextAreaField, TextField } from "@/components/app/fields";
import { DecisionCard, decisionSelect, type DecisionRow } from "@/components/oportunidades/decision-card";
import { createDecision } from "../actions";

export const metadata: Metadata = { title: "Decisiones" };

export default async function DecisionesPage({ params }: PageProps<"/w/[slug]/oportunidades/decisiones">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data } = await supabase.from("decisions").select(decisionSelect).order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as DecisionRow[];
  const names = await profileNames(supabase, rows.flatMap((d) => [d.requested_by, d.decided_by, ...d.comments.map((c) => c.author_id)]));
  const open = rows.filter((d) => d.status === "requested" || d.status === "deferred");
  const closed = rows.filter((d) => d.status === "approved" || d.status === "rejected");
  return (
    <>
      <PageHeader
        title="Decisiones"
        subtitle={ctx.canApprove ? "Podés aprobar, rechazar o diferir. Todo queda auditado." : "Podés pedir decisiones y comentar. Decidir requiere la capacidad de aprobar."}
      />
      <Section title={`Pendientes (${open.length})`}>
        {open.length ? open.map((d) => <DecisionCard key={d.id} d={d} slug={slug} canApprove={ctx.canApprove} names={names} />) : <EmptyState title="No hay decisiones pendientes" />}
      </Section>
      {ctx.canEdit && (
        <details className="mt-6 rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">+ Pedir una decisión general</summary>
          <ActionForm action={createDecision.bind(null, slug, null)} resetOnSuccess className="mt-4 max-w-xl">
            <TextField name="question" label="¿Qué hay que decidir?" />
            <TextAreaField name="context" label="Contexto y evidencia" rows={3} />
            <TextField name="due_on" label="Fecha límite" type="date" />
            <SubmitButton>Pedir decisión</SubmitButton>
          </ActionForm>
        </details>
      )}
      {closed.length > 0 && (
        <Section title="Tomadas" className="mt-8">
          {closed.map((d) => <DecisionCard key={d.id} d={d} slug={slug} canApprove={ctx.canApprove} names={names} />)}
        </Section>
      )}
    </>
  );
}
