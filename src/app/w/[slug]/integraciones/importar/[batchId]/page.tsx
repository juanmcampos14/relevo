import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonX } from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { entityHref } from "@/server/entities";
import type { Issue } from "@/domain/crm-import/map";
import type { FieldChange, FieldConflict } from "@/domain/crm-import/diff";
import type { EntityIds } from "@/server/crm-import/stage";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { contactKind, contactPermission, targetStatus, taskStatus, verificationStatus } from "@/domain/catalogs";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { summarize, triageBatch, type Reason, type TriageRow } from "@/domain/crm-import/triage";
import { applyImport, approveBatch, decideImportRow, discardImport } from "../actions";

export const metadata: Metadata = { title: "Revisar importación" };

const typeLabel: Record<string, string> = { company: "Empresa", contact: "Persona / canal", task: "Actividad", source: "Fuente" };
const actionLabel: Record<string, string> = { crear: "Nueva", actualizar: "Cambios del Sheet", sin_cambios: "Sin cambios", conflicto: "Conflicto", rechazar: "Bloqueada" };
const actionTone: Record<string, string> = {
  crear: "border-sky-500/40 text-sky-800 dark:text-sky-300",
  actualizar: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  conflicto: "border-destructive/50 text-destructive",
  rechazar: "border-destructive/50 text-destructive",
};
const fieldLabel: Record<string, string> = {
  trade_name: "Nombre", activity: "Actividad", locality: "Localidad", address_text: "Dirección", public_phone: "Teléfono", website: "Sitio web",
  sector: "Categoría", priority: "Prioridad", stage: "Etapa", owner_name: "Responsable", verification_status: "Verificación", next_action: "Próxima acción",
  next_action_due: "Fecha próxima acción", notes: "Notas", drive_folder_url: "Carpeta", full_name: "Nombre", contact_kind: "Tipo", role_title: "Cargo",
  email: "Email", phone: "Teléfono", profile_url: "Perfil", preferred_channel: "Canal", relationship_status: "Relación", contact_permission: "Permiso",
  title: "Título", kind: "Tipo", channel: "Canal", due_on: "Vence", status: "Estado", result: "Resultado", url: "URL", publisher: "Tipo de fuente",
  published_on: "Publicada", captured_on: "Consultada", quality: "Calidad", supports: "Hecho que sustenta", limitations: "Limitaciones",
};
const PRIORITY: Record<string, string> = { "1": "Alta", "2": "Media", "3": "Baja" };
const LABELS: Record<string, (v: string) => string> = {
  stage: targetStatus.label,
  verification_status: verificationStatus.label,
  contact_kind: contactKind.label,
  contact_permission: contactPermission.label,
  status: taskStatus.label,
  priority: (v) => PRIORITY[v] ?? v,
};
/** Valor legible: etiquetas de catálogo en lugar de claves internas. */
function show(v: unknown, field?: string) {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return field && LABELS[field] ? LABELS[field](s) : s;
}

type RowView = {
  id: string;
  entity_type: string;
  external_id: string;
  sheet: string;
  row_number: number;
  action: string;
  decision: string;
  applied_at: string | null;
  target_entity_id: string | null;
  raw: { label?: string };
  mapped: { values: Record<string, unknown>; ids: EntityIds };
  issues: Issue[];
  conflicts: { updates?: FieldChange[]; conflicts?: FieldConflict[]; relevoEdited?: boolean };
  resolution: { issues?: Record<string, string>; fields?: Record<string, string> };
};

export default async function ImportReviewPage({ params }: PageProps<"/w/[slug]/integraciones/importar/[batchId]">) {
  const { slug, batchId } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const { data: batch } = await supabase.from("import_batches").select("id, file_name, status, summary, created_at, created_by").eq("id", batchId).maybeSingle();
  if (!batch) notFound();
  const { data: raw } = await supabase
    .from("import_rows")
    .select("id, entity_type, external_id, sheet, row_number, action, decision, applied_at, target_entity_id, raw, mapped, issues, conflicts, resolution")
    .eq("batch_id", batchId)
    .order("entity_type")
    .order("external_id");
  const rows = (raw ?? []) as unknown as RowView[];
  const triage = triageBatch(rows as unknown as TriageRow[]);
  const sum = summarize(rows as unknown as TriageRow[], triage);
  const lane = (r: RowView) => triage.get(r.id)?.lane;
  const pending = rows.filter((r) => r.decision === "pendiente");
  const importable = pending.filter((r) => lane(r) === "importable");
  const review = pending.filter((r) => lane(r) !== "importable");
  const blocked = rows.filter((r) => lane(r) === "bloqueado");
  const toApply = rows.filter((r) => r.decision === "aprobada" && !r.applied_at && r.action !== "sin_cambios");
  // Las filas sin cambios también se confirman: actualizan la procedencia (fecha de reimportación).
  const unconfirmed = rows.filter((r) => r.decision === "aprobada" && !r.applied_at && r.action === "sin_cambios");
  const applied = rows.filter((r) => r.applied_at && r.action !== "sin_cambios");
  const rejected = rows.filter((r) => r.decision === "rechazada" && lane(r) !== "bloqueado");
  const unchanged = rows.filter((r) => r.action === "sin_cambios");
  const summary = batch.summary as { filtro?: string[] | null; ids_formula?: string[] };
  const open = batch.status === "en_revision" && ctx.canEdit;
  const reasonsOf = (r: RowView) => triage.get(r.id)?.reasons ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        back={<Link href={`/w/${slug}/integraciones`} className="hover:underline">← Integraciones</Link>}
        title="Revisar importación del CRM"
        subtitle={`${batch.file_name} · ${formatDate(batch.created_at, true)} · ${batch.status === "en_revision" ? "en revisión" : batch.status}${summary.filtro ? ` · solo ${summary.filtro.join(", ")}` : ""}`}
      />

      {summary.ids_formula?.length ? (
        <p className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
          En {summary.ids_formula.join(", ")} el ID es una fórmula que depende del número de fila: si se insertan o borran filas, los IDs se corren. Conviene fijarlos como valores (copiar → pegar solo valores) antes de seguir cargando.
        </p>
      ) : null}

      {/* Resumen antes de decidir: qué entra, qué hay que mirar, qué no entra y por qué. */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2 rounded-xl border bg-card p-4 shadow-xs">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />{sum.importable.total} sin conflicto</p>
          {sum.importable.total > 0 ? (
            <>
              <ul className="text-sm text-muted-foreground">
                {Object.entries(sum.importable.byKind).map(([k, n]) => <li key={k}>{n} {k}</li>)}
              </ul>
              <p className="text-xs text-muted-foreground">
                Por qué es seguro: no coinciden con nada de RELEVO ni con otra fila del archivo, y los cambios son del Sheet en campos que RELEVO no modificó (sin tocar nombre, teléfono, email ni sitio web).
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nada pendiente para aprobar en lote.</p>
          )}
        </div>
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-card p-4 shadow-xs">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />{review.length} {review.length === 1 ? "requiere" : "requieren"} revisión</p>
          <ul className="text-sm text-muted-foreground">
            {sum.revisar.byReason.map((x) => <li key={x.label}>{x.count} · {x.label.toLowerCase()}</li>)}
          </ul>
        </div>
        <div className="space-y-2 rounded-xl border border-destructive/40 bg-card p-4 shadow-xs">
          <p className="flex items-center gap-2 font-medium"><OctagonX className="size-4 text-destructive" aria-hidden="true" />{blocked.length} {blocked.length === 1 ? "bloqueada" : "bloqueadas"}</p>
          <ul className="text-sm text-muted-foreground">
            {sum.bloqueado.byReason.map((x) => <li key={x.label}>{x.count} · {x.label.toLowerCase()}</li>)}
          </ul>
          {blocked.length > 0 && <p className="text-xs text-muted-foreground">No se importan: corregilas en el Sheet y volvé a importar.</p>}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {unchanged.length} sin cambios (quedan igual) · {toApply.length} aprobadas por escribir · {applied.length} ya escritas{rejected.length ? ` · ${rejected.length} rechazadas` : ""}
      </p>

      {open && (
        <div className="flex flex-wrap gap-3">
          {importable.length > 0 && (
            <ActionForm action={approveBatch.bind(null, slug, batchId)} className="space-y-0">
              <SubmitButton variant={toApply.length ? "outline" : undefined}>Aprobar lote: {importable.length} sin conflicto</SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={applyImport.bind(null, slug, batchId)} className="space-y-0">
            <SubmitButton variant={toApply.length ? undefined : "outline"} disabled={!toApply.length && !unconfirmed.length}>
              {toApply.length ? `Escribir ${toApply.length} aprobadas en RELEVO` : "Cerrar lote (sin cambios)"}
            </SubmitButton>
          </ActionForm>
          <form action={discardImport.bind(null, slug, batchId)}>
            <button className="h-9 px-2 text-sm text-muted-foreground hover:underline">Descartar lote</button>
          </form>
        </div>
      )}

      <RowGroup title="Requieren revisión" rows={review} slug={slug} editable={open} reasonsOf={reasonsOf} />
      {importable.length > 0 && (
        <Section title={`Sin conflicto (${importable.length})`}>
          {sum.importable.notes.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Avisos informativos (no requieren decisión):</p>
              <ul className="text-muted-foreground">
                {sum.importable.notes.map((x) => <li key={x.code}>{x.count} · {x.label}</li>)}
              </ul>
            </div>
          )}
          <details className="rounded-xl border bg-card">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium">Ver las {importable.length} filas (se pueden aprobar o rechazar una por una)</summary>
            <ul className="space-y-3 p-3">
              {importable.map((r) => <RowCard key={r.id} r={r} slug={slug} editable={open} reasons={[]} />)}
            </ul>
          </details>
        </Section>
      )}
      <RowGroup title="Aprobadas, por escribir" rows={toApply} slug={slug} editable={false} reasonsOf={reasonsOf} />
      <RowGroup title="Escritas en RELEVO" rows={applied} slug={slug} editable={false} reasonsOf={reasonsOf} />
      <RowGroup title="Bloqueadas" rows={blocked} slug={slug} editable={false} reasonsOf={reasonsOf} />
      <RowGroup title="Rechazadas" rows={rejected} slug={slug} editable={false} reasonsOf={reasonsOf} />
      {unchanged.length > 0 && (
        <Section title={`Sin cambios (${unchanged.length})`}>
          <p className="text-sm text-muted-foreground">{unchanged.map((r) => r.external_id).join(" · ")}</p>
          {unchanged.some((r) => r.conflicts.relevoEdited) && (
            <p className="text-sm text-muted-foreground">
              El Sheet no cambió, pero en RELEVO difieren (se editaron o se aceptó una propuesta al importar) y se mantienen como están:{" "}
              {unchanged.filter((r) => r.conflicts.relevoEdited).map((r) => r.external_id).join(" · ")}.
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

function RowGroup({ title, rows, slug, editable, reasonsOf }: { title: string; rows: RowView[]; slug: string; editable: boolean; reasonsOf: (r: RowView) => Reason[] }) {
  if (!rows.length) return null;
  return (
    <Section title={`${title} (${rows.length})`}>
      <ul className="space-y-3">
        {rows.map((r) => <RowCard key={r.id} r={r} slug={slug} editable={editable} reasons={reasonsOf(r)} />)}
      </ul>
    </Section>
  );
}

function IssueLine({ i, children }: { i: Issue; children?: ReactNode }) {
  const Icon = i.severity === "bloquea" ? OctagonX : i.severity === "revisar" ? AlertTriangle : Info;
  return (
    <li className="space-y-1.5">
      <p className={cn("flex gap-2 text-sm", i.severity === "bloquea" && "text-destructive")}>
        <Icon className={cn("mt-0.5 size-4 shrink-0", i.severity === "revisar" && "text-amber-600", i.severity === "info" && "text-muted-foreground")} aria-hidden="true" />
        <span>{i.message}</span>
      </p>
      {children}
    </li>
  );
}

function entityLink(r: RowView, slug: string): string | null {
  const id = r.target_entity_id ?? r.mapped.ids.company;
  if (r.entity_type === "company" && id) return entityHref(slug, "company", id);
  return null;
}

function RowCard({ r, slug, editable, reasons }: { r: RowView; slug: string; editable: boolean; reasons: Reason[] }) {
  // Motivos del triage que no son avisos de la fila (duplicado dentro del archivo, cambio material).
  const extra = reasons.filter((x) => x.key === "Posible duplicado dentro del archivo" || x.key === "Cambio en un dato que identifica al registro");
  const updates = r.conflicts.updates ?? [];
  const conflicts = r.conflicts.conflicts ?? [];
  const link = r.applied_at ? entityLink(r, slug) : null;
  const preview = r.action === "crear" ? Object.entries(r.mapped.values).filter(([k, v]) => fieldLabel[k] && v !== null && v !== "").slice(0, 8) : [];
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{r.raw.label ?? r.external_id}</span>
        <Pill>{typeLabel[r.entity_type]} · {r.external_id}</Pill>
        <Pill className={actionTone[r.action]}>{actionLabel[r.action] ?? r.action}</Pill>
        <span className="text-xs text-muted-foreground">{r.sheet}, fila {r.row_number}</span>
        {link && <Link href={link} className="text-sm text-primary hover:underline">Abrir ficha</Link>}
      </div>

      {preview.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {preview.map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="text-muted-foreground">{fieldLabel[k]}:</dt><dd className="min-w-0 break-words">{show(v, k)}</dd></div>
          ))}
        </dl>
      )}

      {extra.length > 0 && (
        <ul className="space-y-1">
          {extra.map((x) => (
            <li key={x.text} className="flex gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />{x.text}</li>
          ))}
        </ul>
      )}

      {r.issues.length > 0 && (
        <ul className="space-y-2">
          {r.issues.map((i, idx) => (
            <IssueLine key={idx} i={i}>
              {i.proposal && i.severity === "revisar" && (
                editable ? (
                  <fieldset className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-sm">
                    <legend className="sr-only">Decisión sobre este punto</legend>
                    <label className="flex min-h-9 items-center gap-2"><input type="radio" name={`issue-${idx}`} value="aplicar" defaultChecked={r.resolution.issues?.[idx] === "aplicar"} className="size-4 accent-primary" />{i.proposal.label}</label>
                    <label className="flex min-h-9 items-center gap-2"><input type="radio" name={`issue-${idx}`} value="ignorar" defaultChecked={r.resolution.issues?.[idx] === "ignorar"} className="size-4 accent-primary" />Dejar como viene</label>
                  </fieldset>
                ) : r.resolution.issues?.[idx] ? (
                  <p className="pl-6 text-xs text-muted-foreground">Decisión: {r.resolution.issues[idx] === "aplicar" ? i.proposal.label : "dejar como viene"}</p>
                ) : null
              )}
            </IssueLine>
          ))}
        </ul>
      )}

      {updates.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">El Sheet cambió (RELEVO no lo había tocado):</p>
          <ul className="space-y-1">
            {updates.map((u) => (
              <li key={u.field}><span className="text-muted-foreground">{fieldLabel[u.field] ?? u.field}:</span> {show(u.from, u.field)} → <span className="font-medium">{show(u.to, u.field)}</span></li>
            ))}
          </ul>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">Cambió en los dos lados: elegí qué valor queda.</p>
          {conflicts.map((c) => (
            <fieldset key={c.field} className="space-y-1 rounded-lg border p-3 text-sm">
              <legend className="px-1 font-medium">{fieldLabel[c.field] ?? c.field}</legend>
              <p className="text-xs text-muted-foreground">Antes (última importación): {show(c.base, c.field)}</p>
              {editable ? (
                <>
                  <label className="flex min-h-9 items-start gap-2"><input type="radio" name={`field-${c.field}`} value="relevo" defaultChecked={r.resolution.fields?.[c.field] === "relevo"} className="mt-1 size-4 accent-primary" /><span><span className="text-muted-foreground">RELEVO:</span> {show(c.relevo, c.field)}</span></label>
                  <label className="flex min-h-9 items-start gap-2"><input type="radio" name={`field-${c.field}`} value="sheet" defaultChecked={r.resolution.fields?.[c.field] === "sheet"} className="mt-1 size-4 accent-primary" /><span><span className="text-muted-foreground">Sheet:</span> {show(c.sheet, c.field)}</span></label>
                </>
              ) : (
                <p>Queda: {r.resolution.fields?.[c.field] === "sheet" ? `${show(c.sheet, c.field)} (Sheet)` : `${show(c.relevo, c.field)} (RELEVO)`}</p>
              )}
            </fieldset>
          ))}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="decision" value="aprobada">Aprobar</SubmitButton>
          <SubmitButton name="decision" value="rechazada" variant="outline">Rechazar</SubmitButton>
        </div>
      )}
    </>
  );
  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-xs", r.action === "conflicto" && "border-destructive/40")}>
      {editable ? (
        <ActionForm action={decideImportRow.bind(null, slug, r.id)} className="space-y-3">{body}</ActionForm>
      ) : (
        <div className="space-y-3">{body}</div>
      )}
    </li>
  );
}
