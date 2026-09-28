import Link from "next/link";
import { decisionStatus } from "@/domain/catalogs";
import { Pill, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextAreaField, TextField } from "@/components/app/fields";
import { addComment, decide } from "@/app/w/[slug]/oportunidades/actions";

export type DecisionRow = {
  id: string;
  kind: string;
  question: string;
  context: string | null;
  due_on: string | null;
  status: string;
  decision_note: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  opportunity_id: string | null;
  opportunities?: { id: string; title: string } | null;
  comments: { id: string; body: string; author_id: string; created_at: string }[];
};

export const decisionSelect =
  "id, kind, question, context, due_on, status, decision_note, requested_by, decided_by, decided_at, created_at, opportunity_id, opportunities(id, title), comments(id, body, author_id, created_at)";

export function DecisionCard({
  d,
  slug,
  canApprove,
  names,
  showOpportunity = true,
}: {
  d: DecisionRow;
  slug: string;
  canApprove: boolean;
  names: Map<string, string>;
  showOpportunity?: boolean;
}) {
  const open = d.status === "requested" || d.status === "deferred";
  const comments = [...d.comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <article className={`space-y-3 rounded-lg border p-4 ${d.status === "requested" ? "border-amber-300/70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill className={d.status === "requested" ? "border-amber-400 text-amber-800 dark:text-amber-300" : ""}>{decisionStatus.label(d.status)}</Pill>
        {d.kind === "aprobar_oportunidad" && <Pill>Aprobar oportunidad</Pill>}
        {d.due_on && <Pill>Vence {formatDate(d.due_on)}</Pill>}
      </div>
      <p className="font-medium">{d.question}</p>
      {showOpportunity && d.opportunities && (
        <Link href={`/w/${slug}/oportunidades/o/${d.opportunities.id}`} className="text-sm text-primary hover:underline">{d.opportunities.title}</Link>
      )}
      {d.context && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{d.context}</p>}
      <p className="text-xs text-muted-foreground">
        Pedida por {names.get(d.requested_by ?? "") ?? "—"} el {formatDate(d.created_at)}
        {d.decided_at && ` · ${decisionStatus.label(d.status).toLowerCase()} por ${names.get(d.decided_by ?? "") ?? "—"} el ${formatDate(d.decided_at, true)}`}
      </p>
      {d.decision_note && <p className="text-sm">Fundamento: {d.decision_note}</p>}

      {open && canApprove && (
        <ActionForm action={decide.bind(null, slug, d.id, d.kind)} className="space-y-3 border-t pt-3">
          <TextField name="decision_note" label="Fundamento (queda registrado)" />
          <div className="flex flex-wrap gap-2">
            <button name="verdict" value="approved" className="inline-flex h-10 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">
              {d.kind === "aprobar_oportunidad" ? "Aprobar y pasar a dealflow" : "Aprobar"}
            </button>
            <button name="verdict" value="rejected" className="inline-flex h-10 items-center rounded-md border px-3 text-sm hover:bg-muted">Rechazar</button>
            {d.status === "requested" && (
              <button name="verdict" value="deferred" className="inline-flex h-10 items-center rounded-md border px-3 text-sm hover:bg-muted">Diferir</button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Una aprobación en la app no equivale a firma ni compromiso legal.</p>
        </ActionForm>
      )}
      {open && !canApprove && <p className="text-xs text-muted-foreground">Esperando a alguien con capacidad de aprobar decisiones.</p>}

      <div className="space-y-2 border-t pt-3">
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium">{names.get(c.author_id) ?? "—"}</span>{" "}
            <span className="text-xs text-muted-foreground">{formatDate(c.created_at, true)}</span>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </div>
        ))}
        <ActionForm action={addComment.bind(null, slug, { decision_id: d.id })} resetOnSuccess className="space-y-2">
          <TextAreaField name="body" label="Comentario" rows={2} />
          <SubmitButton variant="outline">Comentar</SubmitButton>
        </ActionForm>
      </div>
    </article>
  );
}
