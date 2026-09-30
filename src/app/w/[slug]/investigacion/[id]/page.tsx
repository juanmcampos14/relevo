import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { loadDashboard, type Cohort } from "@/server/voice/admin";
import type { SurveyDefinition } from "@/domain/voice/survey";
import { adDestinationUrl } from "@/domain/voice/creative";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { PreviewLink } from "@/components/voice/preview-link";
import { addCost, decideApproval, requestApproval, rotatePreviewLink, saveIdentity, saveVariantMeta, setExperimentStatus, uploadMetaCsv } from "../actions";

export const metadata: Metadata = { title: "Experimento" };

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const PUBLIC_BASE = "https://relevo.site/r/voice-anelo";

export default async function ExperimentPage({ params, searchParams }: PageProps<"/w/[slug]/investigacion/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await getWorkspaceContext(slug);
  const isAdmin = ctx.role === "owner" || ctx.role === "admin";
  const supabase = await createClient();
  const cohorts: Cohort[] = sp.cohorte === "piloto" ? ["piloto"] : sp.cohorte === "prueba" ? ["prueba"] : ["real"];
  const { data: e } = await supabase.from("research_experiments").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [{ data: variants }, { data: version }, { data: decisions }, { data: imports }, { data: costs }] = await Promise.all([
    supabase.from("experiment_variants").select("*").eq("experiment_id", id).order("code"),
    supabase.from("survey_versions").select("id, version, definition, definition_sha, created_at").eq("experiment_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("decisions").select("id, kind, status, question, context, decision_note, decided_at, created_at").eq("experiment_id", id).order("created_at", { ascending: false }),
    supabase.from("ad_metric_imports").select("id, file_name, period_start, period_end, currency, rows_total, rows_applied, rejected, unmatched, created_at").eq("experiment_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("experiment_costs").select("kind, amount, currency, fx_rate, period, document_ref, created_at").eq("experiment_id", id).order("created_at"),
  ]);
  const def = version?.definition as unknown as SurveyDefinition;
  const dash = await loadDashboard(supabase, id, def, cohorts);
  const latest = (kind: string) => decisions?.find((d) => d.kind === kind);
  const base = `/w/${slug}/investigacion`;
  const metaSpend = dash.media.reduce((a, m) => a + m.spend, 0);
  const currency = dash.media[0]?.currency ?? "USD";

  return (
    <>
      <PageHeader title={e.title} subtitle={e.purpose ?? undefined} back={<Link href={base}>← Investigación</Link>} />
      <div className="space-y-8">
        <Section title="Estado">
          <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Pill className={e.status === "activo" ? "border-primary/40 text-primary" : ""}>{e.status}</Pill>
              <span className="text-sm text-muted-foreground">Cuestionario {version?.version} · huella {version?.definition_sha.slice(0, 8)} · ruta pública /r/{e.slug}</span>
            </div>
            <p className="text-xs text-muted-foreground">Borrador y piloto solo abren con el enlace de revisión. Abrir al público exige presupuesto y publicación aprobados y la identidad real completa.</p>
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                {(["borrador", "piloto", "activo", "pausado", "cerrado"] as const).filter((s) => s !== e.status).map((s) => (
                  <ActionForm key={s} action={setExperimentStatus.bind(null, slug, id, s)} className="space-y-0"><SubmitButton variant="outline" className="h-8">Pasar a {s}</SubmitButton></ActionForm>
                ))}
              </div>
            )}
            {isAdmin && <PreviewLink action={rotatePreviewLink.bind(null, slug, id)} />}
          </div>
        </Section>

        <Section title="Aprobaciones (presupuesto y publicación)">
          <div className="grid gap-4 md:grid-cols-2">
            {(["aprobar_presupuesto", "aprobar_publicacion"] as const).map((kind) => {
              const d = latest(kind);
              return (
                <div key={kind} className="space-y-2 rounded-xl border bg-card p-4 text-sm shadow-xs">
                  <p className="font-medium">{kind === "aprobar_presupuesto" ? "Presupuesto de pauta" : "Publicación (landing, cuestionario, anuncios, cuenta)"}</p>
                  {d ? (
                    <>
                      <Pill className={d.status === "approved" ? "border-primary/40 text-primary" : d.status === "rejected" ? "border-destructive/50 text-destructive" : ""}>{d.status === "requested" ? "pendiente" : d.status === "approved" ? "aprobado" : d.status === "rejected" ? "rechazado" : d.status}</Pill>
                      <p className="whitespace-pre-line text-muted-foreground">{d.context}</p>
                      {d.decision_note && <p>Nota: {d.decision_note}</p>}
                      {d.status === "requested" && ctx.canApprove && (
                        <ActionForm action={decideApproval.bind(null, slug, d.id)} className="space-y-2">
                          <TextField name="note" label="Nota (opcional)" />
                          <div className="flex gap-2"><SubmitButton name="verdict" value="aprobar" className="h-8">Aprobar</SubmitButton><SubmitButton name="verdict" value="rechazar" variant="outline" className="h-8">Rechazar</SubmitButton></div>
                        </ActionForm>
                      )}
                    </>
                  ) : <p className="text-muted-foreground">Sin solicitud.</p>}
                  {ctx.canEdit && (!d || d.status !== "requested") && (
                    <details><summary className="cursor-pointer text-primary">Solicitar {d ? "de nuevo" : ""}</summary>
                      <ActionForm action={requestApproval.bind(null, slug, id, kind)} className="mt-2 space-y-2">
                        <TextAreaField name="context" label="Qué se aprueba" rows={4} defaultValue={kind === "aprobar_presupuesto" ? `Pauta Meta: USD ${e.budget_stage1_usd} primera etapa + hasta USD ${Number(e.budget_cap_usd) - Number(e.budget_stage1_usd)} condicionados (techo USD ${e.budget_cap_usd} netos de impuestos). Impuestos, percepciones y tipo de cambio: ver presupuesto total.` : "Landing /r/voice-anelo, cuestionario v1, anuncios A y B (misma imagen), cuenta publicitaria …"} />
                        <SubmitButton className="h-8">Crear solicitud</SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Anuncios para revisar (misma imagen, distinto texto)">
          <div className="grid gap-4 md:grid-cols-2">
            {(variants ?? []).map((v) => (
              <div key={v.id} className="space-y-2 rounded-xl border bg-card p-4 text-sm shadow-xs">
                <p className="font-medium">{v.label}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${base}/creativa?formato=feed`} alt="Creatividad común (borrador)" className="w-full max-w-xs rounded-lg border" />
                <p><span className="text-muted-foreground">Texto principal:</span> {v.primary_text}</p>
                <p><span className="text-muted-foreground">Título:</span> {v.headline}</p>
                <p><span className="text-muted-foreground">Botón (de Meta):</span> {v.cta}</p>
                <p className="break-all text-xs"><span className="text-muted-foreground">URL de destino:</span> {adDestinationUrl(PUBLIC_BASE, v.code)}</p>
                <p className="text-xs text-muted-foreground">{v.what_changes} · <a className="text-primary hover:underline" href={`${base}/creativa?formato=story`} target="_blank">ver 9:16</a></p>
                {isAdmin && (
                  <ActionForm action={saveVariantMeta.bind(null, slug, v.id)} className="grid gap-2 sm:grid-cols-3">
                    <TextField name="meta_campaign_id" label="Campaign ID" defaultValue={v.meta_campaign_id ?? ""} />
                    <TextField name="meta_adset_id" label="Ad set ID" defaultValue={v.meta_adset_id ?? ""} />
                    <TextField name="meta_ad_id" label="Ad ID" defaultValue={v.meta_ad_id ?? ""} />
                    <SubmitButton variant="outline" className="h-8 sm:col-span-3">Guardar IDs de Meta</SubmitButton>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Embudo" actions={<span className="flex gap-2 text-xs">{(["real", "piloto", "prueba"] as const).map((c) => <Link key={c} href={`?cohorte=${c}`} className={cohorts[0] === c ? "font-semibold text-primary" : "text-muted-foreground hover:underline"}>{c}</Link>)}</span>}>
          {dash.canSeeResponses ? (
            <div className="space-y-3">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Etapa</th><th>Total</th>{dash.funnelByVariant.map((v) => <th key={v.variant}>Variante {v.variant}</th>)}</tr></thead>
                <tbody>
                  {dash.funnelAll.map((s, i) => (
                    <tr key={s.key} className="border-t">
                      <td className="py-1.5">{s.label}</td>
                      <td>{s.n} <span className="text-xs text-muted-foreground">{s.of !== null ? `(${pct(s.rate)} de ${s.of})` : ""}</span></td>
                      {dash.funnelByVariant.map((v) => <td key={v.variant}>{v.stages[i].n} <span className="text-xs text-muted-foreground">{v.stages[i].of !== null ? `(${pct(v.stages[i].rate)})` : ""}</span></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">Sin atribución: {dash.unattributed} · fuera de alcance: {dash.outOfScope} · marcadas como automáticas: {dash.flagged}. Clics y reacciones de Meta miden interés por el mensaje; las respuestas son declaraciones autoseleccionadas, no representativas.</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">Sesiones y respuestas: solo owner o admin.</p>}
        </Section>

        <Section title="Métricas de Meta (CSV) y costos">
          <div className="space-y-4">
            {dash.media.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Variante</th><th>Gasto ({currency})</th><th>Impresiones</th><th>Clics en el enlace</th><th>Vistas de la landing (Meta)</th></tr></thead>
                <tbody>{dash.media.map((m) => <tr key={m.variant} className="border-t"><td className="py-1.5">{m.variant}</td><td>{m.spend.toFixed(2)}</td><td>{m.impressions}</td><td>{m.linkClicks}</td><td>{m.lpv}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-sm text-muted-foreground">Todavía no se importó ningún CSV.</p>}
            <p className="text-sm">Gasto informado por Meta: <b>{currency} {metaSpend.toFixed(2)}</b> · Costo facturado registrado: {(costs ?? []).length ? (costs ?? []).map((c) => `${c.kind} ${c.currency} ${Number(c.amount).toFixed(2)}`).join(" · ") : "sin registrar"}</p>
            {isAdmin && (
              <div className="grid gap-4 md:grid-cols-2">
                <ActionForm action={uploadMetaCsv.bind(null, slug, id)} className="space-y-2 rounded-xl border p-4">
                  <p className="text-sm font-medium">Importar CSV de Ads Manager</p>
                  <p className="text-xs text-muted-foreground">Desglose por día, con columnas Ad ID, Campaign ID, Ad set ID, Amount spent, Impressions, Reach, Link clicks, Landing page views. Reimportar un período reemplaza sus números.</p>
                  <input type="file" name="file" accept=".csv,text/csv" className="block text-sm" />
                  <FieldError name="file" />
                  <SubmitButton className="h-8">Importar</SubmitButton>
                </ActionForm>
                <ActionForm action={addCost.bind(null, slug, id)} className="space-y-2 rounded-xl border p-4">
                  <p className="text-sm font-medium">Registrar costo facturado</p>
                  <SelectField name="kind" label="Tipo" options={[["facturado_meta", "Facturado por Meta"], ["iva", "IVA"], ["percepcion", "Percepción"], ["ingresos_brutos", "Ingresos Brutos"], ["honorarios", "Honorarios"], ["otro", "Otro"]].map(([value, label]) => ({ value, label }))} />
                  <div className="grid grid-cols-2 gap-2"><TextField name="amount" label="Monto" inputMode="decimal" /><SelectField name="currency" label="Moneda" options={[{ value: "ARS", label: "ARS" }, { value: "USD", label: "USD" }]} /></div>
                  <div className="grid grid-cols-2 gap-2"><TextField name="fx_rate" label="Tipo de cambio" /><TextField name="period" label="Período" /></div>
                  <TextField name="document_ref" label="Comprobante / resumen" />
                  <SubmitButton className="h-8">Registrar</SubmitButton>
                </ActionForm>
              </div>
            )}
            {!!imports?.length && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {imports.map((i) => <li key={i.id}>{formatDate(i.created_at, true)} · {i.file_name} · {i.period_start} → {i.period_end} · {i.currency} · {i.rows_applied}/{i.rows_total} filas · rechazadas {(i.rejected as unknown[]).length} · sin variante {(i.unmatched as unknown[]).length}</li>)}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Resultados (elegibles; cortes < 5 ocultos)" actions={isAdmin ? <Link href={`${base}/${id}/respuestas`} className="text-sm text-primary hover:underline">Revisar respuestas ({dash.pendingReview} pendientes)</Link> : undefined}>
          {dash.canSeeResponses ? (
            <div className="grid gap-4 md:grid-cols-2">
              {dash.results.map((r) => (
                <div key={r.key} className="rounded-xl border bg-card p-3 text-sm shadow-xs">
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">n = {r.base} elegibles</p>
                  {r.base < 5 || r.cells.every((c) => c.n === null) ? (
                    <p className="mt-2 text-xs text-muted-foreground">Muestra insuficiente: se muestra desde 5 respuestas (y sin revelar categorías).</p>
                  ) : (
                    <ul className="mt-2 space-y-0.5">{r.cells.map((c) => <li key={c.label} className="flex justify-between gap-2"><span>{c.label}</span><span className="tabular-nums">{c.n === null ? "<5" : c.n}</span></li>)}</ul>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Solo owner o admin.</p>}
        </Section>

        {isAdmin && (
          <Section title="Identidad pública y datos">
            <ActionForm action={saveIdentity.bind(null, slug, id)} className="max-w-xl">
              <TextField name="responsible_name" label="Responsable (visible en la landing)" defaultValue={e.responsible_name ?? ""} />
              <TextField name="contact_email" label="Contacto real (email)" type="email" defaultValue={e.contact_email ?? ""} />
              <TextAreaField name="privacy_notice" label="Aviso de privacidad (visible)" rows={5} defaultValue={e.privacy_notice ?? "Las respuestas se guardan en la base privada de RELEVO, con acceso restringido a su equipo responsable. Se analizan de forma agregada y no se publican casos individuales. No se incorporan a ninguna base de contactos ni se comparten con anunciantes. No guardamos tu IP. Podés pedir el borrado de tu respuesta con el código que recibís al terminar."} />
              <TextField name="retention_days" label="Plazo de conservación (días)" type="number" defaultValue={String(e.retention_days)} />
              <SubmitButton>Guardar</SubmitButton>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
