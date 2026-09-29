import Link from "next/link";
import { randomUUID } from "node:crypto";
import { findingKind, findingOrigin, reviewStatus } from "@/domain/catalogs";
import { entityHref, type EntityKind } from "@/server/entities";
import { Pill, StatusBadges, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { TextField } from "@/components/app/fields";
import { createTask, reopenFinding, reviewFinding } from "@/app/w/[slug]/oportunidades/actions";

export type FindingRow = {
  id: string;
  kind: string;
  statement: string;
  evidence: string | null;
  analysis: string | null;
  origin: string;
  verification_status: string;
  review_status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  created_by: string | null;
  visit_id: string | null;
  sources: { id: string; title: string; url: string | null; is_demo: boolean; reference?: string | null } | null;
  entity?: { kind: EntityKind; id: string; name: string } | null;
  finding_evidence?: { stance: string; evidence: { id: string; statement: string; quote: string | null; verification_status: string; capture_id: string | null } | null }[];
};

const STANCE = {
  supports: { label: "A favor", tone: "text-emerald-800 dark:text-emerald-300" },
  contradicts: { label: "En contra", tone: "text-destructive" },
  contextual: { label: "Contexto", tone: "text-muted-foreground" },
} as const;

export function FindingCard({
  f,
  slug,
  canEdit,
  names,
  selectableFor,
  compact = false,
}: {
  f: FindingRow;
  slug: string;
  canEdit: boolean;
  names: Map<string, string>;
  /** id del formulario de candidata al que suma su checkbox (solo aprobados). */
  selectableFor?: string;
  compact?: boolean;
}) {
  const pending = f.review_status === "pendiente_revision";
  const tone = pending ? "border-amber-300/70" : f.review_status === "aprobado" ? "border-primary/40" : "opacity-70";
  return (
    <article id={`h-${f.id}`} className={`scroll-mt-20 space-y-2 rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        {selectableFor && f.review_status === "aprobado" && (
          <input form={selectableFor} type="checkbox" name="finding_ids" value={f.id} aria-label="Incluir en la candidata" className="size-4 accent-[var(--primary)]" />
        )}
        <Pill>{findingKind.label(f.kind)}</Pill>
        <StatusBadges verification={f.verification_status} isDemo={!!f.sources?.is_demo} />
        <Pill className={pending ? "border-amber-400 text-amber-800 dark:text-amber-300" : ""}>{reviewStatus.label(f.review_status)}</Pill>
        {f.origin !== "manual" && <Pill>{findingOrigin.label(f.origin)}</Pill>}
      </div>
      <p className="text-sm font-medium">{f.statement}</p>
      {!compact && f.evidence && <p className="border-l-2 pl-3 text-sm text-muted-foreground italic">“{f.evidence}”</p>}
      {!compact && f.analysis && <p className="text-sm"><span className="text-muted-foreground">Análisis: </span>{f.analysis}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Fuente:{" "}
          {f.sources?.url ? (
            <a href={f.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{f.sources.title}</a>
          ) : f.sources?.reference?.startsWith("captura:") ? (
            <Link href={`/w/${slug}/capturas/${f.sources.reference.slice(8)}`} className="text-primary hover:underline">{f.sources.title}</Link>
          ) : f.visit_id && f.sources ? (
            <Link href={`/w/${slug}/agenda/visita/${f.visit_id}`} className="text-primary hover:underline">{f.sources.title}</Link>
          ) : (
            f.sources?.title ?? "—"
          )}
        </span>
        {f.entity && (
          <Link href={entityHref(slug, f.entity.kind, f.entity.id)} className="text-primary hover:underline">{f.entity.name}</Link>
        )}
        <span>cargado {formatDate(f.created_at)}{f.created_by && ` por ${names.get(f.created_by) ?? "—"}`}</span>
        {f.reviewed_at && <span>revisado {formatDate(f.reviewed_at)} por {names.get(f.reviewed_by ?? "") ?? "—"}</span>}
      </div>
      {f.review_note && <p className="text-xs">Nota de revisión: {f.review_note}</p>}

      {!compact && (f.finding_evidence?.length ?? 0) > 0 && (
        <div className="space-y-1.5 border-t pt-2">
          <p className="text-xs font-medium text-muted-foreground">
            Evidencia · {f.finding_evidence!.filter((x) => x.stance === "supports").length} a favor · {f.finding_evidence!.filter((x) => x.stance === "contradicts").length} en contra
          </p>
          <ul className="space-y-1">
            {[...f.finding_evidence!]
              .sort((a, b) => (a.stance === "contradicts" ? -1 : 0) - (b.stance === "contradicts" ? -1 : 0))
              .map((x) =>
                x.evidence ? (
                  <li key={x.evidence.id} className="text-xs">
                    <span className={`font-medium ${STANCE[x.stance as keyof typeof STANCE]?.tone ?? ""}`}>{STANCE[x.stance as keyof typeof STANCE]?.label ?? x.stance}:</span>{" "}
                    {x.evidence.statement}
                    {x.evidence.capture_id && (
                      <>
                        {" "}
                        <Link href={`/w/${slug}/capturas/${x.evidence.capture_id}`} className="text-primary hover:underline">captura original</Link>
                      </>
                    )}
                  </li>
                ) : null,
              )}
          </ul>
        </div>
      )}

      {canEdit && pending && (
        <ActionForm action={reviewFinding.bind(null, slug, f.id)} className="flex flex-wrap items-end gap-2 space-y-0 border-t pt-3">
          <TextField name="review_note" label="Nota (opcional)" className="min-w-48 flex-1" />
          <div className="flex gap-2">
            <button name="verdict" value="aprobado" className="inline-flex h-10 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">
              Aprobar
            </button>
            <button name="verdict" value="rechazado" className="inline-flex h-10 items-center rounded-md border px-3 text-sm hover:bg-muted">
              Rechazar
            </button>
          </div>
        </ActionForm>
      )}

      {canEdit && !pending && !compact && (
        <div className="flex flex-wrap items-start gap-3 border-t pt-3">
          {f.review_status === "aprobado" && (
            <details className="min-w-64 flex-1">
              <summary className="cursor-pointer text-sm text-primary">+ Crear tarea desde este hallazgo</summary>
              <ActionForm action={createTask.bind(null, slug, { findingId: f.id })} className="mt-2">
                <input type="hidden" name="idempotency_key" value={`finding:${f.id}:${randomUUID()}`} />
                <TextField name="title" label="Tarea" defaultValue={`Verificar: ${f.statement.slice(0, 80)}`} />
                <TextField name="due_on" label="Vence" type="date" />
                <SubmitButton variant="outline">Crear tarea</SubmitButton>
              </ActionForm>
            </details>
          )}
          <form action={reopenFinding.bind(null, slug, f.id)}>
            <button className="text-xs text-muted-foreground hover:underline">Volver a pendiente</button>
          </form>
        </div>
      )}
    </article>
  );
}
