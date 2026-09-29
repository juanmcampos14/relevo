import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { dealflowStage, opportunityRoute, opportunityStatus, taskStatus } from "@/domain/catalogs";
import { entityHref } from "@/server/entities";
import { findingSelect, profileNames, toFindingRow } from "@/server/findings";
import { EmptyState, PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxGroup, SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { FindingCard } from "@/components/oportunidades/finding-card";
import { DecisionCard, decisionSelect, type DecisionRow } from "@/components/oportunidades/decision-card";
import { addComment, createDecision, createTask, linkFindings, requestApproval, setStage, setTaskStatus } from "../../actions";

const fieldLabels: Record<string, string> = { stage: "etapa", status: "estado", next_action: "próxima acción", title: "título", route: "vía" };

export default async function OpportunityPage({ params }: PageProps<"/w/[slug]/oportunidades/o/[oppId]">) {
  const { slug, oppId } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();

  const { data: opp } = await supabase
    .from("opportunities")
    .select("id, title, thesis, route, status, stage, stage_reason, next_action, next_action_due, owner_id, created_by, created_at, campaigns(id, name)")
    .eq("id", oppId)
    .maybeSingle();
  if (!opp) notFound();

  const [{ data: links }, { data: decisionsRaw }, { data: tasks }, { data: comments }, { data: history }, { data: approvedAll }, { data: members }] =
    await Promise.all([
      supabase.from("opportunity_findings").select(`finding_id, findings(${findingSelect})`).eq("opportunity_id", oppId),
      supabase.from("decisions").select(decisionSelect).eq("opportunity_id", oppId).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, title, status, due_on, assignee_id, finding_id").eq("opportunity_id", oppId).order("created_at"),
      supabase.from("comments").select("id, body, author_id, created_at").eq("opportunity_id", oppId).order("created_at"),
      supabase.from("audit_log").select("id, action, changes, created_at, actor_id").eq("entity_id", oppId).order("id", { ascending: false }).limit(20),
      supabase.from("findings").select("id, statement").eq("review_status", "aprobado").order("created_at", { ascending: false }).limit(100),
      supabase.from("memberships").select("user_id").eq("workspace_id", ctx.workspace.id).eq("status", "active").neq("role", "viewer"),
    ]);

  const findings = (links ?? []).flatMap((l) => (l.findings ? [toFindingRow(l.findings)] : []));
  const decisions = (decisionsRaw ?? []) as DecisionRow[];
  const names = await profileNames(supabase, [
    opp.owner_id,
    ...(members ?? []).map((m) => m.user_id),
    ...findings.flatMap((f) => [f.created_by, f.reviewed_by]),
    ...decisions.flatMap((d) => [d.requested_by, d.decided_by, ...d.comments.map((c) => c.author_id)]),
    ...(comments ?? []).map((c) => c.author_id),
    ...(history ?? []).map((h) => h.actor_id),
  ]);
  const linked = new Set(findings.map((f) => f.id));
  const linkable = (approvedAll ?? []).filter((f) => !linked.has(f.id));
  const entities = new Map(findings.flatMap((f) => (f.entity ? [[`${f.entity.kind}:${f.entity.id}`, f.entity] as const] : [])));
  const allUnverified = findings.length > 0 && findings.every((f) => !["publicly_verified", "field_verified"].includes(f.verification_status));
  const openApproval = decisions.find((d) => d.kind === "aprobar_oportunidad" && (d.status === "requested" || d.status === "deferred"));
  const memberOptions = (members ?? []).map((m) => ({ value: m.user_id, label: names.get(m.user_id) ?? "—" }));

  return (
    <>
      <PageHeader
        back={
          <Link href={`/w/${slug}/oportunidades/${opp.status === "aprobada" ? "dealflow" : "candidatas"}`} className="hover:underline">
            ← {opp.status === "aprobada" ? "Dealflow" : "Candidatas"}
          </Link>
        }
        title={opp.title}
        actions={<Link href={`/w/${slug}/ai?scope=opportunity:${oppId}`} className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted">Preguntar a RELEVO AI</Link>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Pill className={opp.status === "aprobada" ? "border-primary text-primary" : ""}>{opportunityStatus.label(opp.status)}</Pill>
            {opp.stage && <Pill>{dealflowStage.label(opp.stage)}</Pill>}
            <span>Vía: {opportunityRoute.label(opp.route)}</span>
            {opp.campaigns && <span>· {opp.campaigns.name}</span>}
            <span>· creada {formatDate(opp.created_at)} por {names.get(opp.created_by ?? "") ?? "—"}</span>
          </span>
        }
      />
      {opp.thesis && <p className="-mt-3 mb-5 max-w-3xl text-sm whitespace-pre-wrap">{opp.thesis}</p>}
      {allUnverified && (
        <p className="mb-5 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Ningún hallazgo que la sustenta está verificado (en campo o públicamente): todo es parcial o sin verificar. Se puede decidir igual, pero con esa advertencia.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {/* Decisión de aprobación / dealflow */}
          {opp.status === "candidata" && (
            <Section title="Aprobación">
              {openApproval ? (
                <DecisionCard d={openApproval} slug={slug} canApprove={ctx.canApprove} names={names} showOpportunity={false} />
              ) : ctx.canEdit ? (
                <ActionForm action={requestApproval.bind(null, slug, oppId)} className="rounded-lg border p-4">
                  <TextField name="question" label="Pregunta a decidir" defaultValue={`¿Pasamos “${opp.title}” al dealflow?`} />
                  <TextAreaField name="context" label="Contexto (qué sabemos, qué falta, riesgos)" rows={3} />
                  <TextField name="due_on" label="Fecha límite (opcional)" type="date" />
                  <SubmitButton>Pedir aprobación</SubmitButton>
                </ActionForm>
              ) : (
                <EmptyState title="Sin solicitud de aprobación" />
              )}
            </Section>
          )}
          {opp.status === "aprobada" && (
            <Section title="Dealflow">
              <div className="rounded-lg border p-4">
                <p className="text-sm">
                  Etapa actual: <strong>{dealflowStage.label(opp.stage ?? "")}</strong>
                  {opp.stage_reason && ` · ${opp.stage_reason}`}
                </p>
                {opp.next_action && <p className="text-sm text-muted-foreground">Próxima acción: {opp.next_action} {opp.next_action_due && `(${formatDate(opp.next_action_due)})`}</p>}
                {ctx.canEdit && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-primary">Actualizar etapa</summary>
                    <ActionForm action={setStage.bind(null, slug, oppId)} className="mt-3">
                      <SelectField name="stage" label="Etapa" defaultValue={opp.stage ?? ""} options={dealflowStage.values.map((v) => ({ value: v, label: dealflowStage.label(v) }))} />
                      <TextField name="stage_reason" label="Motivo (obligatorio si se pausa o descarta)" defaultValue={opp.stage_reason ?? ""} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField name="next_action" label="Próxima acción" defaultValue={opp.next_action ?? ""} />
                        <TextField name="next_action_due" label="Fecha" type="date" defaultValue={opp.next_action_due ?? ""} />
                      </div>
                      <SubmitButton variant="outline">Guardar</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </div>
            </Section>
          )}

          <Section title={`Hallazgos que la sustentan (${findings.length})`}>
            <div className="space-y-3">
              {findings.map((f) => <FindingCard key={f.id} f={f} slug={slug} canEdit={false} names={names} compact />)}
            </div>
            {ctx.canEdit && linkable.length > 0 && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Vincular otros hallazgos aprobados</summary>
                <ActionForm action={linkFindings.bind(null, slug, oppId)} className="mt-3">
                  <CheckboxGroup name="finding_ids" label="Hallazgos aprobados" options={linkable.map((f) => ({ value: f.id, label: f.statement.slice(0, 90) }))} />
                  <SubmitButton variant="outline">Vincular</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>

          <Section title="Tareas">
            {tasks?.length ? (
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div>
                      <span className={t.status === "done" ? "line-through text-muted-foreground" : ""}>{t.title}</span>
                      <div className="text-xs text-muted-foreground">
                        {taskStatus.label(t.status)}
                        {t.assignee_id && ` · ${names.get(t.assignee_id) ?? "—"}`}
                        {t.due_on && ` · vence ${formatDate(t.due_on)}`}
                      </div>
                    </div>
                    {ctx.canEdit && (
                      <div className="flex gap-1">
                        {taskStatus.values.filter((s) => s !== t.status).map((s) => (
                          <form key={s} action={setTaskStatus.bind(null, slug, t.id, s)}>
                            <button className="rounded border px-2 py-1 text-xs hover:bg-muted">{taskStatus.label(s)}</button>
                          </form>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin tareas.</p>
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Tarea</summary>
                <ActionForm action={createTask.bind(null, slug, { opportunityId: oppId })} className="mt-3">
                  <input type="hidden" name="idempotency_key" value={`opp:${oppId}:${randomUUID()}`} />
                  <TextField name="title" label="Tarea" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField name="assignee_id" label="Responsable" options={memberOptions} placeholder="— Sin asignar —" defaultValue={ctx.user.id} />
                    <TextField name="due_on" label="Vence" type="date" />
                  </div>
                  <SubmitButton variant="outline">Crear tarea</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>

          <Section title="Decisiones">
            {decisions.filter((d) => d !== openApproval || opp.status !== "candidata").length ? (
              decisions
                .filter((d) => d !== openApproval || opp.status !== "candidata")
                .map((d) => <DecisionCard key={d.id} d={d} slug={slug} canApprove={ctx.canApprove} names={names} showOpportunity={false} />)
            ) : (
              <p className="text-sm text-muted-foreground">Sin otras decisiones.</p>
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Pedir otra decisión sobre esta oportunidad</summary>
                <ActionForm action={createDecision.bind(null, slug, oppId)} resetOnSuccess className="mt-3">
                  <TextField name="question" label="¿Qué hay que decidir?" />
                  <TextAreaField name="context" label="Contexto" rows={2} />
                  <TextField name="due_on" label="Fecha límite" type="date" />
                  <SubmitButton variant="outline">Pedir decisión</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>
        </div>

        <aside className="space-y-8">
          <Section title="Registros involucrados">
            {entities.size ? (
              <ul className="space-y-1 text-sm">
                {[...entities.values()].map((e) => (
                  <li key={e.id}><Link href={entityHref(slug, e.kind, e.id)} className="text-primary hover:underline">{e.name}</Link></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Los hallazgos no están vinculados a registros.</p>
            )}
          </Section>

          <Section title="Comentarios">
            <div className="space-y-3">
              {(comments ?? []).map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{names.get(c.author_id) ?? "—"}</span>{" "}
                  <span className="text-xs text-muted-foreground">{formatDate(c.created_at, true)}</span>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
            <ActionForm action={addComment.bind(null, slug, { opportunity_id: oppId })} resetOnSuccess className="space-y-2">
              <TextAreaField name="body" label="Comentario / brainstorming" rows={3} />
              <SubmitButton variant="outline">Comentar</SubmitButton>
            </ActionForm>
          </Section>

          <Section title="Historial">
            <ol className="space-y-2 text-xs">
              {(history ?? []).map((h) => (
                <li key={h.id} className="border-l-2 pl-3">
                  <div className="text-muted-foreground">{formatDate(h.created_at, true)} · {h.actor_id ? names.get(h.actor_id) ?? "usuario" : "sistema"}</div>
                  <div>
                    {h.action === "insert"
                      ? "Creada como candidata"
                      : `Cambió ${Object.keys((h.changes as Record<string, unknown>) ?? {}).map((k) => fieldLabels[k] ?? k).join(", ")}`}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </aside>
      </div>
    </>
  );
}
