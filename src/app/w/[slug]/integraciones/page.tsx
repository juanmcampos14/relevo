import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { publicEnv } from "@/lib/env";
import { MAX_ITEMS } from "@/domain/ingest";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { TextAreaField, TextField } from "@/components/app/fields";
import { TokenForm } from "@/components/app/token-form";
import { createIngestToken, importBatch, revokeIngestToken } from "./actions";
import { closeSheet, reopenSheet, setCutoffDate, uploadCrm } from "./importar/actions";
import { readCutover, reconciliationBatch } from "@/domain/crm-import/cutover";
import Link from "next/link";

export const metadata: Metadata = { title: "Integraciones" };

const EXAMPLE = `{
  "source_system": "morning-brief",
  "items": [
    {
      "url": "https://medio.example/nota",
      "title": "Título de la nota",
      "publisher": "Medio",
      "published_at": "2026-09-28",
      "statement": "Qué dice la fuente, en una afirmación concreta",
      "kind": "senal_de_mercado",
      "evidence": "Cita textual (opcional)",
      "analysis": "Por qué importa para RELEVO (opcional)",
      "topic": "inmuebles",
      "entity_hint": "Nombre de empresa o lugar mencionado (opcional)"
    }
  ]
}`;

export default async function IntegracionesPage({ params }: PageProps<"/w/[slug]/integraciones">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const canManage = ctx.role === "owner" || ctx.role === "admin";
  const { data: tokens } = canManage
    ? await supabase.from("ingest_tokens").select("id, name, token_hint, created_at, last_used_at, revoked_at").order("created_at", { ascending: false })
    : { data: [] };
  const endpoint = `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/ingest/findings`;
  const { data: batches } = await supabase.from("import_batches").select("id, file_name, status, summary, created_at").order("created_at", { ascending: false }).limit(30);
  const cutover = readCutover(ctx.workspace.settings);
  const recon = reconciliationBatch(batches ?? [], cutover.cutoff_on);
  const isOwner = ctx.role === "owner";

  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader
        title="Integraciones"
        subtitle="Research externo (Morning Brief) → hallazgos pendientes de revisión, con fuente, URL, fecha y evidencia. Nunca crea oportunidades."
      />

      <Section title="CRM de Google Sheets">
        <p className="text-sm text-muted-foreground">
          Exportá el Sheet (Archivo → Descargar → Microsoft Excel .xlsx) y subilo. RELEVO arma una propuesta por fila —nueva, cambios del
          Sheet, conflicto o sin cambios— y no escribe nada hasta que la revisás y aprobás. Reimportar no duplica ni pisa lo editado en RELEVO.
        </p>
        <div className={`space-y-3 rounded-xl border p-4 text-sm ${cutover.status === "cerrado" ? "border-emerald-500/40 bg-emerald-500/5" : "bg-card"}`}>
          {cutover.status === "cerrado" ? (
            <p><span className="font-medium">Corte registrado el {formatDate(cutover.closed_at, true)}.</span> RELEVO es la fuente de verdad; el Sheet queda como respaldo y no se vuelve a importar.</p>
          ) : (
            <>
              <p>
                <span className="font-medium">El Sheet sigue siendo fuente operativa activa</span>
                {cutover.cutoff_on ? ` hasta el ${formatDate(cutover.cutoff_on)}.` : " hasta que se acuerde una fecha de corte."}{" "}
                Antes del corte: una importación completa (sin filtro), revisada y aplicada, como reconciliación final.
              </p>
              <p className="text-muted-foreground">
                Reconciliación final: {recon ? <Link href={`/w/${slug}/integraciones/importar/${recon.id}`} className="text-primary hover:underline">lote aplicado listo</Link> : cutover.cutoff_on ? "todavía no hay un lote completo aplicado desde la fecha de corte." : "se habilita al fijar la fecha."}
              </p>
            </>
          )}
          {isOwner && cutover.status === "activo" && (
            <div className="flex flex-wrap items-end gap-3">
              <ActionForm action={setCutoffDate.bind(null, slug)} className="flex items-end gap-2 space-y-0">
                <label className="space-y-1"><span className="block text-xs font-medium">Fecha de corte</span><input type="date" name="cutoff_on" defaultValue={cutover.cutoff_on ?? ""} className="h-9 rounded-lg border bg-background px-2" /></label>
                <SubmitButton variant="outline">Guardar fecha</SubmitButton>
              </ActionForm>
              {recon && (
                <ActionForm action={closeSheet.bind(null, slug, recon.id)} className="flex items-end gap-2 space-y-0">
                  <label className="flex h-9 items-center gap-2 text-xs"><input type="checkbox" name="confirm" className="size-4 accent-primary" />Revisé la reconciliación (altas, cambios, conflictos, duplicados)</label>
                  <SubmitButton>Registrar el corte</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
          {isOwner && cutover.status === "cerrado" && (
            <details>
              <summary className="cursor-pointer text-xs text-primary">Reabrir el Sheet como fuente (excepcional)</summary>
              <ActionForm action={reopenSheet.bind(null, slug)} className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                <input name="reason" placeholder="Motivo (queda en el historial)" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3" />
                <SubmitButton variant="outline">Reabrir</SubmitButton>
              </ActionForm>
            </details>
          )}
          {cutover.history.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {cutover.history.map((h, i) => <li key={i}>{formatDate(h.at, true)} · {h.by} · {h.note}</li>)}
            </ul>
          )}
        </div>
        {ctx.canEdit && cutover.status === "activo" && (
          <ActionForm action={uploadCrm.bind(null, slug)}>
            <div className="space-y-1">
              <label htmlFor="crm-file" className="text-sm font-medium">Archivo .xlsx</label>
              <input id="crm-file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:bg-card file:px-3" />
              <FieldError name="file" />
            </div>
            <TextField name="ids" label="Solo estas empresas (opcional)" placeholder="AN-0023, AN-0054, AN-0029" hint="Para un piloto: se incluyen sus contactos, actividades y fuentes." />
            <SubmitButton>Analizar archivo</SubmitButton>
          </ActionForm>
        )}
        {batches?.length ? (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {batches.map((b) => {
              const s = b.summary as Record<string, unknown>;
              return (
                <li key={b.id}>
                  <Link href={`/w/${slug}/integraciones/importar/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-muted/50">
                    <span>
                      <span className="font-medium">{b.file_name}</span>{" "}
                      <span className="text-muted-foreground">· {formatDate(b.created_at, true)}{Array.isArray(s.filtro) ? ` · ${(s.filtro as string[]).join(", ")}` : ""}</span>
                    </span>
                    <Pill>{b.status === "en_revision" ? "En revisión" : b.status === "aplicado" ? "Aplicado" : "Descartado"}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>

      <Section title="Importar un lote a mano">
        <p className="text-sm text-muted-foreground">
          Pegá el JSON que genera el Morning Brief (hasta {MAX_ITEMS} ítems). Si un ítem ya se importó (misma URL y misma afirmación), no se duplica.
        </p>
        {ctx.canEdit && (
          <ActionForm action={importBatch.bind(null, slug)}>
            <TextAreaField name="json" label="JSON" rows={10} placeholder={EXAMPLE} className="font-mono" />
            <SubmitButton>Importar</SubmitButton>
          </ActionForm>
        )}
      </Section>

      {canManage && (
        <Section title="Ingesta automática (API)">
          <div className="space-y-2 text-sm">
            <p>
              Endpoint: <code className="rounded bg-muted px-1">POST {endpoint}</code>
            </p>
            <p>
              Encabezado <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> y el mismo JSON de arriba. Responde cuántos se crearon, cuántos ya existían y cuáles se rechazaron.
            </p>
          </div>
          <TokenForm action={createIngestToken.bind(null, slug)} />
          {tokens?.length ? (
            <ul className="divide-y rounded-xl border bg-card shadow-xs">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <span className="font-medium">{t.name}</span> <span className="text-muted-foreground">…{t.token_hint}</span>
                    <div className="text-xs text-muted-foreground">
                      creado {formatDate(t.created_at)} · {t.last_used_at ? `último uso ${formatDate(t.last_used_at, true)}` : "sin uso"}
                    </div>
                  </div>
                  {t.revoked_at ? (
                    <Pill>Revocado</Pill>
                  ) : (
                    <form action={revokeIngestToken.bind(null, slug, t.id)}>
                      <button className="text-sm text-destructive hover:underline">Revocar</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      )}
    </div>
  );
}
