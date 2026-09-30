import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, Building2, Check, CheckCircle2, CircleSlash, Landmark, ListChecks, Lightbulb, ListTodo, MapPin, Mic, Quote, ScrollText, ShieldAlert, TrendingUp, UserRound, X } from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { CAPTURE_BUCKET, formatDuration } from "@/domain/capture";
import { assetKind, assetOperation, evidenceType, findingKind, verificationStatus } from "@/domain/catalogs";
import { entityHref } from "@/server/entities";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { AudioPlayer } from "@/components/app/audio-player";
import { APP_VERSION } from "@/lib/build";
import { approveCaptureAction, decideProposalAction, processCaptureNow } from "../actions";
import { captureExceptions } from "@/domain/capture-review";
import type { ActionState } from "@/server/action-result";
import { captureEffects, type CaptureEffects } from "@/server/findings/effects";

export const metadata: Metadata = { title: "Captura" };
// Procesar y re-evaluar findings (IA) corren en Server Actions de esta página.
export const maxDuration = 120;

type Proposal = {
  id: string;
  kind: "company" | "asset" | "person" | "evidence" | "finding" | "next_action";
  status: "propuesta" | "aceptada" | "editada" | "rechazada";
  payload: Record<string, unknown>;
  final_payload: Record<string, unknown> | null;
  quote: string | null;
  matches: { type: string; id: string; name: string; reason: string }[];
  result_type: string | null;
  result_id: string | null;
  decided_by: string | null;
};

/** Sujeto de un dato (las propuestas anteriores usaban about_company). */
const aboutOf = (p: Record<string, unknown>) => (p.about as string | undefined) ?? (p.about_company ? "company" : "none");

// Empresa y activo se muestran como grupos con sus datos adentro; el resto, por tipo.
const GROUPS: { key: string; title: string; icon: typeof Building2; match: (p: Proposal) => boolean }[] = [
  { key: "person", title: "Personas", icon: UserRound, match: (p) => p.kind === "person" },
  { key: "evidence", title: "Otros datos", icon: ScrollText, match: (p) => p.kind === "evidence" },
  { key: "finding", title: "Posible finding", icon: Lightbulb, match: (p) => p.kind === "finding" },
  { key: "next_action", title: "Próximas acciones", icon: ListTodo, match: (p) => p.kind === "next_action" },
];

const input = "h-11 w-full rounded-lg border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function CapturePage({ params }: PageProps<"/w/[slug]/capturas/[id]">) {
  const { slug, id } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const { data: c } = await supabase
    .from("captures")
    .select("id, body, captured_at, captured_by, latitude, longitude, location_accuracy_m, ai_consent, status, status_error, ai_summary, ai_unknowns, capture_media(id, kind, storage_path, duration_ms)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const { data: rawProposals } = await supabase
    .from("proposals")
    .select("id, kind, status, payload, final_payload, quote, matches, result_type, result_id, decided_by")
    .eq("capture_id", id)
    .order("position");
  const proposals = (rawProposals ?? []) as unknown as Proposal[];

  const findingIds = [...new Set(proposals.flatMap((p) => [
    ...((p.payload.related_findings as { finding_id: string }[] | undefined) ?? []).map((r) => r.finding_id),
    ...(p.kind === "finding" && typeof p.payload.link_to === "string" ? [p.payload.link_to] : []),
  ]))];
  const resolvesIds = proposals.map((p) => p.payload.resolves).filter((x): x is string => typeof x === "string" && !!x);
  const [{ data: signed }, { data: people }, { data: findings }, { data: transcripts }, { data: unresolvedRows }] = await Promise.all([
    c.capture_media.length ? supabase.storage.from(CAPTURE_BUCKET).createSignedUrls(c.capture_media.map((m) => m.storage_path), 3600) : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("user_id, display_name, email").in("user_id", [c.captured_by, ...proposals.map((p) => p.decided_by)].filter((x): x is string => !!x)),
    findingIds.length ? supabase.from("findings").select("id, statement").in("id", findingIds) : Promise.resolve({ data: [] }),
    supabase.from("transcripts").select("capture_media_id, status, text, utterances, error, provider, model").eq("capture_id", id),
    resolvesIds.length ? supabase.from("unresolved_entities").select("id, label").in("id", resolvesIds) : Promise.resolve({ data: [] }),
  ]);
  const unresolvedLabel = new Map((unresolvedRows ?? []).map((u) => [u.id, u.label]));
  const transcriptOf = new Map((transcripts ?? []).map((t) => [t.capture_media_id, t]));
  const mediaUrl = new Map(c.capture_media.map((m) => [m.id, urlOf_(m.storage_path)]));
  function urlOf_(path: string) {
    return (signed ?? []).find((s) => s.path === path)?.signedUrl ?? null;
  }
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.display_name || p.email]));
  const findingText = new Map((findings ?? []).map((f) => [f.id, f.statement]));
  const byKey = new Map(proposals.filter((p) => p.payload.key).map((p) => [String(p.payload.key), p]));
  const pending = proposals.filter((p) => p.status === "propuesta").length;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const effects = proposals.length ? await captureEffects(supabase, id, today) : null;
  const canProcess = ctx.canEdit && c.ai_consent && (c.status === "guardado" || c.status === "error");
  const exceptions = captureExceptions(proposals);
  const cardProps = { slug, editable: ctx.canEdit, byKey, findingText, mediaUrl, unresolvedLabel };

  return (
    <div className="space-y-8">
      <AutoRefresh active={c.status === "procesando"} />
      <PageHeader
        back={<Link href={`${base}/capturas`} className="hover:underline">← Capturas</Link>}
        title="Captura de campo"
        subtitle={`${nameOf.get(c.captured_by ?? "") ?? "—"} · ${formatDate(c.captured_at, true)}`}
      />

      {(c.status === "procesando" || (c.status === "error" && c.status_error) || !c.ai_consent || canProcess) && (
        <div className="space-y-3">
          {c.status === "procesando" && <p className="rounded-xl border border-dashed p-4 text-sm">Procesando… la página se actualiza sola.</p>}
          {c.status === "error" && c.status_error && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{c.status_error}</p>}
          {!c.ai_consent && <p className="text-sm text-muted-foreground">Esta captura se guardó sin &quot;Procesar con IA&quot;: queda como material crudo.</p>}
          {canProcess && (
            <ActionForm action={processCaptureNow.bind(null, slug, c.id)} className="space-y-0">
              <SubmitButton>{c.status === "error" ? "Reintentar procesamiento" : "Procesar con IA"}</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}

      {proposals.length > 0 && (
        <Executive
          summary={c.ai_summary}
          unknowns={c.ai_unknowns}
          proposals={proposals}
          exceptions={exceptions}
          findingText={findingText}
          unresolvedLabel={unresolvedLabel}
          approve={ctx.canEdit && pending > exceptions.size ? approveCaptureAction.bind(null, slug, c.id) : null}
          pendingNormal={pending - exceptions.size}
        >
          {[...exceptions].map(([pid, why]) => {
            const p = proposals.find((x) => x.id === pid)!;
            return (
              <div key={pid} className="space-y-1">
                <p className="flex gap-2 text-sm font-medium text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{why}</p>
                <ul><ProposalCard p={p} decidedBy={undefined} {...cardProps} /></ul>
              </div>
            );
          })}
        </Executive>
      )}

      {effects && <EffectsSection effects={effects} base={base} />}

      <Section title="Original (audio, fotos y nota)">
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
          {c.body ? <p className="text-base whitespace-pre-wrap">{c.body}</p> : <p className="text-sm text-muted-foreground">Sin texto.</p>}
          {c.capture_media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {c.capture_media.map((m) => {
                const url = urlOf.get(m.storage_path);
                if (!url) return <Pill key={m.id}>Archivo no disponible</Pill>;
                return m.kind === "photo" ? (
                  <a key={m.id} href={url} target="_blank" rel="noopener noreferrer" className="relative block size-28 overflow-hidden rounded-lg border">
                    <Image src={url} alt="Foto de la captura" fill unoptimized className="object-cover" sizes="7rem" />
                  </a>
                ) : (
                  <div key={m.id} className="w-full space-y-2">
                    <AudioPlayer src={url} durationMs={m.duration_ms} />
                    <Transcript t={transcriptOf.get(m.id)} url={url} />
                  </div>
                );
              })}
            </div>
          )}
          {c.latitude != null && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 text-sm text-primary hover:underline">
              <MapPin className="size-4" aria-hidden="true" />
              Ubicación GPS{c.location_accuracy_m ? ` ±${Math.round(c.location_accuracy_m)} m` : ""} · sin verificar
            </a>
          )}
        </div>
      </Section>


      {proposals.length > 0 && (
      <details className="group rounded-xl border bg-card/50" open={false}>
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 text-sm font-medium">
          <ListChecks className="size-4 text-primary" aria-hidden="true" />
          Revisar {proposals.length} elementos detectados
          <span className="font-normal text-muted-foreground">({pending ? `${pending} por decidir` : "todo decidido"}; aceptar, editar o rechazar uno por uno)</span>
        </summary>
        <div className="space-y-6 p-3">
        {(["company", "asset"] as const).map((subject) => {
          const head = proposals.find((p) => p.kind === subject);
          if (!head) return null;
          const facts = proposals.filter((p) => p.kind === "evidence" && aboutOf(p.payload) === subject);
          const Icon = subject === "company" ? Building2 : Landmark;
          return (
            <div key={subject} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4 text-primary" aria-hidden="true" />
                {subject === "company" ? "Empresa propuesta" : "Activo propuesto"}
              </h3>
              <div className="rounded-xl border bg-card shadow-xs">
                <ProposalCard as="div" p={head} slug={slug} editable={ctx.canEdit} decidedBy={nameOf.get(head.decided_by ?? "")} byKey={byKey} findingText={findingText} mediaUrl={mediaUrl} unresolvedLabel={unresolvedLabel} groupSize={facts.filter((f) => f.status === "propuesta").length} />
                {facts.length > 0 && (
                  <ul className="divide-y border-t">
                    <li className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">RELEVO detectó {facts.length} {facts.length === 1 ? "dato" : "datos"}:</li>
                    {facts.map((f) => (
                      <ProposalCard key={f.id} compact p={f} slug={slug} editable={ctx.canEdit} decidedBy={nameOf.get(f.decided_by ?? "")} byKey={byKey} findingText={findingText} mediaUrl={mediaUrl} unresolvedLabel={unresolvedLabel} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
        {GROUPS.map(({ key, title, icon: Icon, match }) => {
          const items = proposals.filter((p) => match(p) && !(p.kind === "evidence" && aboutOf(p.payload) !== "none" && proposals.some((h) => h.kind === aboutOf(p.payload))));
          if (!items.length) return null;
          return (
            <div key={key} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4 text-primary" aria-hidden="true" />
                {title}
              </h3>
              <ul className="space-y-3">
                {items.map((p) => (
                  <ProposalCard key={p.id} p={p} slug={slug} editable={ctx.canEdit} decidedBy={nameOf.get(p.decided_by ?? "")} byKey={byKey} findingText={findingText} mediaUrl={mediaUrl} unresolvedLabel={unresolvedLabel} />
                ))}
              </ul>
            </div>
          );
        })}
        </div>
      </details>
      )}
      <p className="text-center text-xs text-muted-foreground">RELEVO versión {APP_VERSION}</p>
    </div>
  );
}

function statusPill(p: Proposal, decidedBy: string | undefined) {
  if (p.status === "propuesta") return <Pill className="border-sky-500/40 text-sky-800 dark:text-sky-300">Propuesta</Pill>;
  if (p.status === "rechazada") return <Pill><CircleSlash className="mr-1 size-3" aria-hidden="true" />Rechazada{decidedBy ? ` · ${decidedBy}` : ""}</Pill>;
  return (
    <Pill className="border-emerald-500/40 text-emerald-800 dark:text-emerald-300">
      <CheckCircle2 className="mr-1 size-3" aria-hidden="true" />
      {p.status === "editada" ? "Editada y aceptada" : "Aceptada"}
      {decidedBy ? ` · ${decidedBy}` : ""}
    </Pill>
  );
}

function resultLink(p: Proposal, slug: string): ReactNode {
  if (!p.result_id) return null;
  const base = `/w/${slug}`;
  const href =
    p.result_type === "company" ? entityHref(slug, "company", p.result_id) : p.result_type === "asset" ? entityHref(slug, "asset", p.result_id) : p.result_type === "finding" ? `${base}/hallazgos/${p.result_id}` : p.result_type === "unresolved" ? `${base}/explorar/sin-identificar` : null;
  return href ? <Link href={href} className="text-sm text-primary hover:underline">Abrir</Link> : null;
}

function ProposalCard({ p, slug, editable, decidedBy, byKey, findingText, mediaUrl, unresolvedLabel, compact = false, groupSize, as = "li" }: {
  /** compact: fila dentro de un grupo. groupSize: datos pendientes del grupo (muestra "Aceptar todo"). */
  compact?: boolean;
  groupSize?: number;
  as?: "li" | "div";
  p: Proposal;
  slug: string;
  editable: boolean;
  decidedBy?: string;
  byKey: Map<string, Proposal>;
  findingText: Map<string, string>;
  mediaUrl: Map<string, string | null>;
  unresolvedLabel: Map<string, string>;
}) {
  const audio = p.payload.audio as { capture_media_id: string; start_ms: number } | undefined;
  const audioUrl = audio ? mediaUrl.get(audio.capture_media_id) : null;
  const v = { ...p.payload, ...(p.final_payload ?? {}) };
  const open = editable && p.status === "propuesta";
  const personLabel = (key: unknown) => {
    const pp = byKey.get(String(key));
    return pp ? String(pp.payload.name ?? pp.payload.role ?? "") : null;
  };

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {statusPill(p, decidedBy)}
        {resultLink(p, slug)}
      </div>
      {p.kind === "company" && (
        <div className="space-y-1">
          <p className="text-base font-medium">{String(v.name)}{v.locality ? <span className="font-normal text-muted-foreground"> · {String(v.locality)}</span> : null}{v.activity ? <span className="font-normal text-muted-foreground"> · {String(v.activity)}</span> : null}{v.identified === false ? <Pill className="ml-2">Sin identificar</Pill> : null}</p>
          {v.identified === false && <p className="text-xs text-muted-foreground">Sabemos que existe, no cuál es: se guarda como organización sin identificar (no como empresa) y se resuelve cuando se sepa.</p>}
          {typeof v.resolves === "string" && v.resolves && <p className="text-xs font-medium">Sería la organización sin identificar «{unresolvedLabel.get(v.resolves) ?? "de una captura anterior"}»: su evidencia pasaría a esta empresa.</p>}
        </div>
      )}
      {p.kind === "asset" && (
        <p className="text-base font-medium">
          {String(v.title)}
          <span className="block text-sm font-normal text-muted-foreground">
            {[assetKind.label(String(v.kind)), assetOperation.label(String(v.operation)), v.address_text, v.surface_m2 ? `${v.surface_m2} m² (según la fuente)` : null].filter(Boolean).join(" · ")}
          </span>
        </p>
      )}
      {p.kind === "person" && (
        <p className="text-base font-medium">
          {String(v.name ?? v.role ?? "")}
          {v.name && v.role ? <span className="font-normal text-muted-foreground"> · {String(v.role)}</span> : null}
          {!v.name && (!v.institutional || byKey.get("c")?.payload.identified === false || !byKey.get("c")) ? <Pill className="ml-2">Sin identificar</Pill> : v.institutional ? <Pill className="ml-2">Canal institucional</Pill> : null}
          {typeof v.resolves === "string" && v.resolves && <span className="block text-xs font-medium">Sería «{unresolvedLabel.get(v.resolves) ?? "una persona de una captura anterior"}»: lo que dijo pasaría a esta persona.</span>}
        </p>
      )}
      {p.kind === "evidence" && (
        <div className="space-y-1">
          <p className={compact ? "text-sm" : "text-base"}>{String(v.statement)}</p>
          <p className="text-xs text-muted-foreground">{evidenceType.label(String(v.evidence_type))} · {originLabel(v, personLabel)}</p>
          {((v.related_findings as { finding_id: string; stance: string }[] | undefined) ?? []).map((r) => (
            <p key={r.finding_id} className={cn("text-xs", r.stance === "contradicts" ? "font-medium text-destructive" : "text-muted-foreground")}>
              {r.stance === "contradicts" ? "En contra de" : r.stance === "supports" ? "A favor de" : "Contexto para"}: “{findingText.get(r.finding_id) ?? "finding"}”
            </p>
          ))}
        </div>
      )}
      {p.kind === "finding" && (
        <div className="space-y-1">
          {typeof v.link_to === "string" && v.link_to ? (
            <>
              <p className="text-sm"><span className="font-medium">{RELATION[String(v.relation ?? "apoya")] ?? "Sobre"}</span> la hipótesis existente «{findingText.get(v.link_to) ?? "hipótesis"}»</p>
              {typeof v.refined_statement === "string" && v.refined_statement && <p className="text-base font-medium">Nuevo enunciado: «{v.refined_statement}»</p>}
            </>
          ) : (
            <p className="text-base font-medium">{v.is_idea ? <Pill className="mr-2">Idea</Pill> : <Pill className="mr-2">Hipótesis</Pill>}{String(v.statement)}</p>
          )}
          <p className="text-sm text-muted-foreground">{String(v.rationale ?? "")}</p>
          {((v.supports as string[]) ?? []).length > 0 && <p className="text-xs text-muted-foreground">A favor: {((v.supports as string[]) ?? []).map((k) => `“${byKey.get(k)?.payload.statement ?? k}”`).join(" · ")}</p>}
          {((v.contradicts as string[]) ?? []).length > 0 && <p className="text-xs font-medium text-destructive">En contra: {((v.contradicts as string[]) ?? []).map((k) => `“${byKey.get(k)?.payload.statement ?? k}”`).join(" · ")}</p>}
          <p className="text-xs text-muted-foreground">
            {typeof v.link_to === "string" && v.link_to
              ? "Aceptarlo suma la evidencia aceptada a esa hipótesis (no crea otra)."
              : v.is_idea
                ? "Una idea de quien capturó: se guarda para investigar, no es evidencia de demanda."
                : `Aceptarla abre una hipótesis exploratoria (${findingKind.label(String(v.kind))}); pasa a finding cuando la evidencia lo sostenga.`}
          </p>
        </div>
      )}
      {p.kind === "next_action" && (
        <div className="space-y-1">
          <p className="text-base font-medium">{String(v.title)}</p>
          <p className="text-sm text-muted-foreground">{String(v.why ?? "")}{v.contact ? ` · con ${personLabel(v.contact)}` : ""}{v.due ? ` · ${formatDate(String(v.due))}` : ""}</p>
        </div>
      )}
      {p.quote && (
        <blockquote className="flex gap-2 border-l-2 pl-3 text-sm text-muted-foreground italic">
          <Quote className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{audio ? "Del audio" : "De la nota"}: “{p.quote}”</span>
        </blockquote>
      )}
      {audio && audioUrl && (
        <a href={`${audioUrl}#t=${Math.floor(audio.start_ms / 1000)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 text-sm text-primary hover:underline">
          <Mic className="size-4" aria-hidden="true" />
          Escuchar desde {formatDuration(audio.start_ms)}
        </a>
      )}

      {open && p.matches.length > 0 && (p.kind === "company" || p.kind === "asset" || p.kind === "person" || p.kind === "finding") && (
        <fieldset className="space-y-1 rounded-lg border p-3 text-sm">
          <legend className="px-1 font-medium">¿Ya existe?</legend>
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name="link_to" value="nuevo" defaultChecked={!v.link_to} className="size-4 accent-primary" />Crear {p.kind === "company" ? "una empresa nueva" : p.kind === "asset" ? "un activo nuevo" : p.kind === "finding" ? "una hipótesis nueva" : "una persona nueva"}</label>
          {p.matches.map((m) => (
            <label key={m.id} className="flex min-h-10 items-start gap-2 py-1"><input type="radio" name="link_to" value={m.id} defaultChecked={v.link_to === m.id} className="mt-0.5 size-4 accent-primary" /><span>{p.kind === "finding" ? "Es la misma hipótesis que" : "Es"} “{m.name}” <span className="text-muted-foreground">({m.reason}{p.kind === "finding" ? "; la evidencia se suma ahí" : ""})</span></span></label>
          ))}
        </fieldset>
      )}

      {open && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">Editar antes de aceptar</summary>
          <div className="mt-3 space-y-3">
            {/* Valores de partida (incluye los defaults que muestra el formulario): solo lo que cambie cuenta como edición. */}
            <input type="hidden" name="original" value={JSON.stringify(p.kind === "evidence" ? { ...p.payload, verification_status: isObserved(v) ? "field_verified" : "unverified" } : p.payload)} />
            {p.kind === "company" && (
              <>
                <Field label="Nombre"><input name="name" defaultValue={String(v.name ?? "")} className={input} /></Field>
                <Field label="Localidad"><input name="locality" defaultValue={String(v.locality ?? "")} className={input} /></Field>
                <Field label="Actividad"><input name="activity" defaultValue={String(v.activity ?? "")} className={input} /></Field>
              </>
            )}
            {p.kind === "asset" && (
              <>
                <Field label="Nombre"><input name="title" defaultValue={String(v.title ?? "")} className={input} /></Field>
                <Field label="Operación">
                  <select name="operation" defaultValue={String(v.operation ?? "desconocida")} className={input}>
                    {assetOperation.values.map((t) => <option key={t} value={t}>{assetOperation.label(t)}</option>)}
                  </select>
                </Field>
                <Field label="Dirección"><input name="address_text" defaultValue={String(v.address_text ?? "")} className={input} /></Field>
                <Field label="Superficie según la fuente (m²)"><input name="surface_m2" inputMode="decimal" defaultValue={v.surface_m2 != null ? String(v.surface_m2) : ""} className={input} /></Field>
              </>
            )}
            {p.kind === "person" && (
              <>
                <Field label="Nombre (vacío si no se sabe)"><input name="name" defaultValue={String(v.name ?? "")} className={input} /></Field>
                <Field label="Cargo o área"><input name="role" defaultValue={String(v.role ?? "")} className={input} /></Field>
              </>
            )}
            {p.kind === "evidence" && (
              <>
                <Field label="Qué sabemos"><textarea name="statement" defaultValue={String(v.statement ?? "")} rows={2} className={cn(input, "h-auto py-2")} /></Field>
                <Field label="Tipo (define cuándo revalidar)">
                  <select name="evidence_type" defaultValue={String(v.evidence_type ?? "dato")} className={input}>
                    {evidenceType.values.map((t) => <option key={t} value={t}>{evidenceType.label(t)}</option>)}
                  </select>
                </Field>
                <Field label="Verificación">
                  <select name="verification_status" defaultValue={isObserved(v) ? "field_verified" : "unverified"} className={input}>
                    {verificationStatus.values.map((t) => <option key={t} value={t}>{verificationStatus.label(t)}</option>)}
                  </select>
                </Field>
              </>
            )}
            {p.kind === "finding" && (
              <>
                {typeof v.refined_statement === "string" && v.refined_statement ? (
                  <Field label="Nuevo enunciado de la hipótesis"><textarea name="refined_statement" defaultValue={String(v.refined_statement)} rows={2} className={cn(input, "h-auto py-2")} /></Field>
                ) : (
                  <Field label="Hipótesis"><textarea name="statement" defaultValue={String(v.statement ?? "")} rows={2} className={cn(input, "h-auto py-2")} /></Field>
                )}
                <Field label="Por qué / qué falta"><textarea name="rationale" defaultValue={String(v.rationale ?? "")} rows={2} className={cn(input, "h-auto py-2")} /></Field>
              </>
            )}
            {p.kind === "next_action" && (
              <>
                <Field label="Acción"><input name="title" defaultValue={String(v.title ?? "")} className={input} /></Field>
                <Field label="Fecha (opcional)"><input name="due" type="date" defaultValue={String(v.due ?? "")} className={input} /></Field>
              </>
            )}
          </div>
        </details>
      )}

      {open && groupSize != null && groupSize > 0 && (
        <>
          <input type="hidden" name="group" value={p.kind} />
          <SubmitButton name="decision" value="todo" className="h-11 w-full text-base">Aceptar todo ({groupSize + 1})</SubmitButton>
        </>
      )}
      {open && compact && (
        <div className="flex gap-2">
          <SubmitButton name="decision" value="aceptar" variant="outline" className="h-10 flex-1"><Check className="size-4" aria-hidden="true" />Aceptar</SubmitButton>
          <SubmitButton name="decision" value="rechazar" variant="outline" className="h-10 flex-1"><X className="size-4" aria-hidden="true" />Rechazar</SubmitButton>
        </div>
      )}
      {open && !compact && (
        <div className="flex gap-2">
          <SubmitButton name="decision" value="aceptar" variant={groupSize ? "outline" : "default"} className="h-11 flex-1 text-base">{groupSize ? "Aceptar solo esto" : "Aceptar"}</SubmitButton>
          <SubmitButton name="decision" value="rechazar" variant="outline" className="h-11 flex-1 text-base">Rechazar</SubmitButton>
        </div>
      )}
    </>
  );

  const Wrapper = as;
  return (
    <Wrapper className={cn(compact || as === "div" ? "px-4 py-3" : "rounded-xl border bg-card p-4 shadow-xs", p.status === "rechazada" && "opacity-60")}>
      {open ? (
        <ActionForm action={decideProposalAction.bind(null, slug, p.id)} className={compact ? "space-y-2" : "space-y-3"}>{content}</ActionForm>
      ) : (
        <div className={compact ? "space-y-2" : "space-y-3"}>{content}</div>
      )}
    </Wrapper>
  );
}

const isObserved = (v: Record<string, unknown>) => v.origin === "observado" || v.origin === "observacion_directa";

/** Observé algo ≠ una fuente afirma algo ≠ verifiqué el dato. */
function originLabel(v: Record<string, unknown>, personLabel: (key: unknown) => string | null): string {
  if (isObserved(v)) return "observado en persona (queda verificado en campo)";
  if (v.origin === "declarado_por_documento") return `declarado por ${String(v.declared_by || "un documento o cartel")}, observado en campo (sin verificar)`;
  return v.stated_by ? `declarado por ${personLabel(v.stated_by)} (sin verificar)` : "lo afirma quien capturó, sin fuente indicada (sin verificar)";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function Transcript({ t, url }: { t?: { status: string; text: string | null; utterances: unknown; error: string | null }; url: string }) {
  if (!t) return <p className="text-xs text-muted-foreground">Sin transcribir todavía.</p>;
  if (t.status === "error") return <p className="text-xs text-destructive">Transcripción: {t.error}</p>;
  const segs = (t.utterances as { start_ms: number; text: string }[] | null) ?? [];
  return (
    <details open className="rounded-lg bg-muted/50 p-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Transcripción automática (puede tener errores)</summary>
      {segs.length ? (
        <ol className="mt-2 space-y-1">
          {segs.map((s, i) => (
            <li key={i} className="flex gap-2">
              <a href={`${url}#t=${Math.floor(s.start_ms / 1000)}`} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-xs text-primary hover:underline">{formatDuration(s.start_ms)}</a>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 whitespace-pre-wrap">{t.text || "(sin habla reconocible)"}</p>
      )}
    </details>
  );
}

/** E1 — qué cambió (o cambiaría) en lo que sabemos con esta captura. */
function EffectsSection({ effects, base }: { effects: CaptureEffects; base: string }) {
  const { applied, predicted, newFindings, noRelation } = effects;
  if (!applied.length && !predicted.length && !newFindings.length && !noRelation) return null;
  const line = (e: CaptureEffects["applied"][number], future: boolean) => (
    <li key={`${future}-${e.findingId}`} className="flex gap-2 p-3 text-sm">
      {e.kinds.includes("contradice") ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /> : <TrendingUp className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />}
      <span>
        {future && <span className="font-medium">Si aceptás: </span>}
        {e.text} <Link href={`${base}/hallazgos/${e.findingId}`} className="text-primary hover:underline">Ver estado</Link>
      </span>
    </li>
  );
  return (
    <Section title="Qué cambió con esta captura">
      <ul className="divide-y rounded-xl border bg-card shadow-xs">
        {applied.map((e) => line(e, false))}
        {predicted.filter((p) => !applied.some((a) => a.findingId === p.findingId && a.text === p.text)).map((e) => line(e, true))}
        {newFindings.map((f) => (
          <li key={f.statement} className="flex gap-2 p-3 text-sm">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              {f.accepted ? "Nueva hipótesis abierta: " : "Propone una hipótesis nueva (no se encontró una existente): "}«{f.statement}»
              {f.id && <> <Link href={`${base}/hallazgos/${f.id}`} className="text-primary hover:underline">Ver estado</Link></>}
            </span>
          </li>
        ))}
        {noRelation && <li className="p-3 text-sm text-muted-foreground">Todavía no existe un finding relacionado con lo que capturaste: queda como evidencia en su empresa o activo.</li>}
      </ul>
    </Section>
  );
}

const RELATION: Record<string, string> = { apoya: "Apoya", contradice: "Contradice", acota: "Acota", amplia: "Amplía", segmenta: "Segmenta" };
const q = (x: unknown) => `«${String(x)}»`;

/** Una línea en lenguaje llano por lo que RELEVO propone guardar o cambiar. */
function proposalLine(p: Proposal, findingText: Map<string, string>, unresolvedLabel: Map<string, string>, companyUnresolved: boolean): string {
  const v = { ...p.payload, ...(p.final_payload ?? {}) };
  switch (p.kind) {
    case "company":
      if (typeof v.resolves === "string" && v.resolves) return `Identificar ${q(unresolvedLabel.get(v.resolves) ?? "la organización de antes")} como ${q(v.name)}`;
      if (v.identified === false) return `Guardar ${q(v.name)} como organización sin identificar`;
      return typeof v.link_to === "string" && v.link_to ? `Vincular con la empresa existente ${q(v.name)}` : `Guardar la empresa ${q(v.name)}`;
    case "asset":
      return `Guardar el activo ${q(v.title)}`;
    case "person":
      if (typeof v.resolves === "string" && v.resolves) return `Identificar ${q(unresolvedLabel.get(v.resolves) ?? "la persona de antes")} como ${v.name}`;
      if (v.name) return `Guardar a ${v.name}${v.role ? ` (${v.role})` : ""}`;
      return v.institutional && !companyUnresolved ? `Registrar el canal ${q(v.role)}` : `Guardar ${q(v.role)} como persona sin identificar`;
    case "finding": {
      const existing = typeof v.link_to === "string" && v.link_to ? findingText.get(v.link_to) ?? "una hipótesis existente" : null;
      if (!existing) return v.is_idea ? `Guardar la idea ${q(v.statement)} para investigar` : `Abrir la hipótesis ${q(v.statement)}`;
      if (typeof v.refined_statement === "string" && v.refined_statement) return `Reformular ${q(existing)} → ${q(v.refined_statement)}`;
      return v.relation === "contradice" ? `Registrar evidencia en contra de ${q(existing)}` : `Sumar evidencia a ${q(existing)}`;
    }
    default:
      return String(v.title ?? v.statement ?? "");
  }
}

function LineIcon({ p, exception }: { p: Proposal; exception: boolean }) {
  if (p.status === "aceptada" || p.status === "editada") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Guardado" />;
  if (p.status === "rechazada") return <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Rechazado" />;
  if (exception) return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Requiere tu decisión" />;
  return <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />;
}

/**
 * Primera capa de la revisión: qué entendió RELEVO, qué propone y qué haría ahora, con una sola
 * aprobación para lo normal. El detalle (cada elemento, su fuente y su segundo del audio) queda abajo.
 */
function Executive({ summary, unknowns, proposals, exceptions, findingText, unresolvedLabel, approve, pendingNormal, children }: {
  summary: string | null;
  unknowns: string[];
  proposals: Proposal[];
  exceptions: Map<string, string>;
  findingText: Map<string, string>;
  unresolvedLabel: Map<string, string>;
  approve: (() => Promise<ActionState>) | null;
  pendingNormal: number;
  children: ReactNode;
}) {
  const company = proposals.find((p) => p.kind === "company");
  const companyUnresolved = company?.payload.identified === false;
  const people = proposals.filter((p) => p.kind === "person");
  const talkedWith = [
    ...people.map((p) => String(p.payload.name ?? p.payload.role ?? "")).filter(Boolean),
  ];
  const org = company ? `${String(company.payload.name)}${companyUnresolved ? " (sin identificar)" : ""}` : null;
  const evidence = proposals.filter((p) => p.kind === "evidence" && p.status !== "rechazada");
  const observed = evidence.filter((e) => isObserved(e.payload)).length;
  const against = evidence.filter((e) => ((e.payload.related_findings as { stance: string }[] | undefined) ?? []).some((r) => r.stance === "contradicts")).length;
  const structural = proposals.filter((p) => ["company", "asset", "person", "finding"].includes(p.kind));
  const actions = proposals.filter((p) => p.kind === "next_action" && p.status !== "rechazada");
  const allDone = proposals.every((p) => p.status !== "propuesta");

  return (
    <>
      <Section title="RELEVO entendió esto">
        <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
          {summary && <p className="text-base">{summary}</p>}
          {(talkedWith.length > 0 || org) && (
            <p className="text-sm">
              <span className="font-medium">Hablaste con: </span>
              {[talkedWith.join(", "), org].filter(Boolean).join(talkedWith.length ? " · " : "")}
            </p>
          )}
          {evidence.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Lo importante</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {evidence.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    {String(e.payload.statement)}
                    <span className="text-xs text-muted-foreground"> · {isObserved(e.payload) ? "observado" : e.payload.origin === "declarado_por_documento" ? "lo dice un cartel o documento" : e.payload.stated_by ? "declarado" : "sin fuente indicada"}</span>
                  </li>
                ))}
                {evidence.length > 5 && <li className="list-none text-xs text-muted-foreground">y {evidence.length - 5} datos más en el detalle.</li>}
              </ul>
            </div>
          )}
          {unknowns.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Todavía no sabemos</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {unknowns.map((u) => <li key={u}>{u}</li>)}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section title="RELEVO propone">
        <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
          <ul className="space-y-1.5 text-sm">
            {structural.map((p) => (
              <li key={p.id} className={cn("flex gap-2", p.status === "rechazada" && "text-muted-foreground line-through")}>
                <LineIcon p={p} exception={exceptions.has(p.id)} />
                <span>{proposalLine(p, findingText, unresolvedLabel, companyUnresolved)}</span>
              </li>
            ))}
            {evidence.length > 0 && (
              <li className="flex gap-2">
                <LineIcon p={evidence.every((e) => e.status !== "propuesta") ? evidence[0] : { ...evidence[0], status: "propuesta" }} exception={false} />
                <span>
                  Conservar {evidence.length} {evidence.length === 1 ? "dato" : "datos"} con su fuente
                  <span className="text-muted-foreground"> ({[observed ? `${observed} observado${observed === 1 ? "" : "s"}` : null, evidence.length - observed ? `${evidence.length - observed} declarado${evidence.length - observed === 1 ? "" : "s"} sin verificar` : null, against ? `${against} en contra de una hipótesis` : null].filter(Boolean).join(", ")})</span>
                </span>
              </li>
            )}
          </ul>
          {actions.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Qué haría ahora</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                {actions.map((a) => <li key={a.id} className={cn(a.status !== "propuesta" && "text-muted-foreground")}>{String(a.payload.title)}</li>)}
              </ol>
            </div>
          )}
          {exceptions.size > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-sm font-semibold">Esto requiere tu decisión ({exceptions.size})</p>
              {children}
            </div>
          )}
          {approve ? (
            <ActionForm action={approve} className="space-y-1">
              <SubmitButton className="h-12 w-full text-base">{exceptions.size ? `Aprobar lo demás (${pendingNormal})` : "Aprobar propuesta"}</SubmitButton>
              <p className="text-center text-xs text-muted-foreground">Guarda y relaciona cada elemento con su fuente (y el segundo del audio). Podés revisarlos uno por uno abajo.</p>
            </ActionForm>
          ) : allDone ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" aria-hidden="true" />Todo decidido: lo aceptado quedó guardado y relacionado.</p>
          ) : null}
        </div>
      </Section>
    </>
  );
}
