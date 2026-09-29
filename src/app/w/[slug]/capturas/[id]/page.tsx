import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Building2, CheckCircle2, CircleSlash, Lightbulb, ListTodo, MapPin, Mic, Quote, ScrollText, UserRound } from "lucide-react";
import { cn } from "cn";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { CAPTURE_BUCKET, formatDuration } from "@/domain/capture";
import { evidenceType, findingKind, verificationStatus } from "@/domain/catalogs";
import { entityHref } from "@/server/entities";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { decideProposalAction, processCaptureNow } from "../actions";

export const metadata: Metadata = { title: "Captura" };

type Proposal = {
  id: string;
  kind: "company" | "person" | "evidence" | "finding" | "next_action";
  status: "propuesta" | "aceptada" | "editada" | "rechazada";
  payload: Record<string, unknown>;
  final_payload: Record<string, unknown> | null;
  quote: string | null;
  matches: { type: string; id: string; name: string; reason: string }[];
  result_type: string | null;
  result_id: string | null;
  decided_by: string | null;
};

const SECTIONS: { kind: Proposal["kind"]; title: string; icon: typeof Building2 }[] = [
  { kind: "company", title: "Empresa", icon: Building2 },
  { kind: "person", title: "Personas", icon: UserRound },
  { kind: "evidence", title: "Evidencia", icon: ScrollText },
  { kind: "finding", title: "Posible finding", icon: Lightbulb },
  { kind: "next_action", title: "Próximas acciones", icon: ListTodo },
];

const input = "h-11 w-full rounded-lg border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function CapturePage({ params }: PageProps<"/w/[slug]/capturas/[id]">) {
  const { slug, id } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const { data: c } = await supabase
    .from("captures")
    .select("id, body, captured_at, captured_by, latitude, longitude, location_accuracy_m, ai_consent, status, status_error, ai_summary, capture_media(id, kind, storage_path, duration_ms)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const { data: rawProposals } = await supabase
    .from("proposals")
    .select("id, kind, status, payload, final_payload, quote, matches, result_type, result_id, decided_by")
    .eq("capture_id", id)
    .order("position");
  const proposals = (rawProposals ?? []) as unknown as Proposal[];

  const findingIds = [...new Set(proposals.flatMap((p) => ((p.payload.related_findings as { finding_id: string }[] | undefined) ?? []).map((r) => r.finding_id)))];
  const [{ data: signed }, { data: people }, { data: findings }] = await Promise.all([
    c.capture_media.length ? supabase.storage.from(CAPTURE_BUCKET).createSignedUrls(c.capture_media.map((m) => m.storage_path), 3600) : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("user_id, display_name, email").in("user_id", [c.captured_by, ...proposals.map((p) => p.decided_by)].filter((x): x is string => !!x)),
    findingIds.length ? supabase.from("findings").select("id, statement").in("id", findingIds) : Promise.resolve({ data: [] }),
  ]);
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const nameOf = new Map((people ?? []).map((p) => [p.user_id, p.display_name || p.email]));
  const findingText = new Map((findings ?? []).map((f) => [f.id, f.statement]));
  const byKey = new Map(proposals.filter((p) => p.payload.key).map((p) => [String(p.payload.key), p]));
  const pending = proposals.filter((p) => p.status === "propuesta").length;
  const canProcess = ctx.canEdit && c.ai_consent && (c.status === "guardado" || c.status === "error");

  return (
    <div className="space-y-8">
      <AutoRefresh active={c.status === "procesando"} />
      <PageHeader
        back={<Link href={`${base}/capturas`} className="hover:underline">← Capturas</Link>}
        title="Captura de campo"
        subtitle={`${nameOf.get(c.captured_by ?? "") ?? "—"} · ${formatDate(c.captured_at, true)}`}
      />

      <Section title="Original">
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
                  <div key={m.id} className="flex items-center gap-2">
                    <Mic className="size-4 text-muted-foreground" aria-hidden="true" />
                    <audio controls preload="none" src={url} className="h-10 max-w-[16rem]" />
                    {m.duration_ms != null && <span className="text-xs text-muted-foreground">{formatDuration(m.duration_ms)}</span>}
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

      <Section title="Lo que propone RELEVO">
        {c.status === "procesando" && <p className="rounded-xl border border-dashed p-4 text-sm">Procesando… la página se actualiza sola.</p>}
        {c.status === "error" && c.status_error && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{c.status_error}</p>}
        {!c.ai_consent && <p className="text-sm text-muted-foreground">Esta captura se guardó sin &quot;Procesar con IA&quot;: queda como material crudo.</p>}
        {canProcess && (
          <ActionForm action={processCaptureNow.bind(null, slug, c.id)} className="space-y-0">
            <SubmitButton>{c.status === "error" ? "Reintentar procesamiento" : "Procesar con IA"}</SubmitButton>
          </ActionForm>
        )}
        {c.ai_summary && (
          <p className="rounded-xl bg-muted/60 p-4 text-sm">
            <span className="font-medium">Resumen (propuesta): </span>
            {c.ai_summary}
          </p>
        )}
        {proposals.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {pending ? `${pending} por decidir. ` : "Todo decidido. "}Nada se guarda sin que lo aceptes; lo aceptado queda vinculado a esta captura.
          </p>
        )}
        {SECTIONS.map(({ kind, title, icon: Icon }) => {
          const items = proposals.filter((p) => p.kind === kind);
          if (!items.length) return null;
          return (
            <div key={kind} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4 text-primary" aria-hidden="true" />
                {title}
              </h3>
              <ul className="space-y-3">
                {items.map((p) => (
                  <ProposalCard key={p.id} p={p} slug={slug} editable={ctx.canEdit} decidedBy={nameOf.get(p.decided_by ?? "")} byKey={byKey} findingText={findingText} />
                ))}
              </ul>
            </div>
          );
        })}
      </Section>
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
    p.result_type === "company" ? entityHref(slug, "company", p.result_id) : p.result_type === "finding" ? `${base}/oportunidades?h=${p.result_id}#h-${p.result_id}` : null;
  return href ? <Link href={href} className="text-sm text-primary hover:underline">Abrir</Link> : null;
}

function ProposalCard({ p, slug, editable, decidedBy, byKey, findingText }: {
  p: Proposal;
  slug: string;
  editable: boolean;
  decidedBy?: string;
  byKey: Map<string, Proposal>;
  findingText: Map<string, string>;
}) {
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
        <p className="text-base font-medium">{String(v.name)}{v.locality ? <span className="font-normal text-muted-foreground"> · {String(v.locality)}</span> : null}{v.activity ? <span className="font-normal text-muted-foreground"> · {String(v.activity)}</span> : null}</p>
      )}
      {p.kind === "person" && (
        <p className="text-base font-medium">
          {String(v.name ?? v.role ?? "")}
          {v.name && v.role ? <span className="font-normal text-muted-foreground"> · {String(v.role)}</span> : null}
          {v.institutional ? <Pill className="ml-2">Canal institucional</Pill> : null}
        </p>
      )}
      {p.kind === "evidence" && (
        <div className="space-y-1">
          <p className="text-base">{String(v.statement)}</p>
          <p className="text-xs text-muted-foreground">
            {evidenceType.label(String(v.evidence_type))} · {v.origin === "observacion_directa" ? "observado en persona (se guarda como verificado en campo)" : `declarado${v.stated_by ? ` por ${personLabel(v.stated_by)}` : ""} (se guarda sin verificar)`}
          </p>
          {((v.related_findings as { finding_id: string; stance: string }[] | undefined) ?? []).map((r) => (
            <p key={r.finding_id} className={cn("text-xs", r.stance === "contradicts" ? "font-medium text-destructive" : "text-muted-foreground")}>
              {r.stance === "contradicts" ? "En contra de" : r.stance === "supports" ? "A favor de" : "Contexto para"}: “{findingText.get(r.finding_id) ?? "finding"}”
            </p>
          ))}
        </div>
      )}
      {p.kind === "finding" && (
        <div className="space-y-1">
          <p className="text-base font-medium">{String(v.statement)}</p>
          <p className="text-sm text-muted-foreground">{String(v.rationale ?? "")}</p>
          {((v.supports as string[]) ?? []).length > 0 && <p className="text-xs text-muted-foreground">A favor: {((v.supports as string[]) ?? []).map((k) => `“${byKey.get(k)?.payload.statement ?? k}”`).join(" · ")}</p>}
          {((v.contradicts as string[]) ?? []).length > 0 && <p className="text-xs font-medium text-destructive">En contra: {((v.contradicts as string[]) ?? []).map((k) => `“${byKey.get(k)?.payload.statement ?? k}”`).join(" · ")}</p>}
          <p className="text-xs text-muted-foreground">Aceptarlo lo promueve a finding ({findingKind.label(String(v.kind))}) con la evidencia que hayas aceptado.</p>
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
          <span>De la nota: “{p.quote}”</span>
        </blockquote>
      )}

      {open && p.matches.length > 0 && (p.kind === "company" || p.kind === "person") && (
        <fieldset className="space-y-1 rounded-lg border p-3 text-sm">
          <legend className="px-1 font-medium">¿Ya existe?</legend>
          <label className="flex min-h-10 items-center gap-2"><input type="radio" name="link_to" value="nuevo" defaultChecked className="size-4 accent-primary" />Crear {p.kind === "company" ? "una empresa nueva" : "una persona nueva"}</label>
          {p.matches.map((m) => (
            <label key={m.id} className="flex min-h-10 items-center gap-2"><input type="radio" name="link_to" value={m.id} className="size-4 accent-primary" />Es “{m.name}” ({m.reason})</label>
          ))}
        </fieldset>
      )}

      {open && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">Editar antes de aceptar</summary>
          <div className="mt-3 space-y-3">
            {/* Valores de partida (incluye los defaults que muestra el formulario): solo lo que cambie cuenta como edición. */}
            <input type="hidden" name="original" value={JSON.stringify(p.kind === "evidence" ? { ...p.payload, verification_status: v.origin === "observacion_directa" ? "field_verified" : "unverified" } : p.payload)} />
            {p.kind === "company" && (
              <>
                <Field label="Nombre"><input name="name" defaultValue={String(v.name ?? "")} className={input} /></Field>
                <Field label="Localidad"><input name="locality" defaultValue={String(v.locality ?? "")} className={input} /></Field>
                <Field label="Actividad"><input name="activity" defaultValue={String(v.activity ?? "")} className={input} /></Field>
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
                  <select name="verification_status" defaultValue={v.origin === "observacion_directa" ? "field_verified" : "unverified"} className={input}>
                    {verificationStatus.values.map((t) => <option key={t} value={t}>{verificationStatus.label(t)}</option>)}
                  </select>
                </Field>
              </>
            )}
            {p.kind === "finding" && (
              <>
                <Field label="Finding"><textarea name="statement" defaultValue={String(v.statement ?? "")} rows={2} className={cn(input, "h-auto py-2")} /></Field>
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

      {open && (
        <div className="flex gap-2">
          <SubmitButton name="decision" value="aceptar" className="h-11 flex-1 text-base">Aceptar</SubmitButton>
          <SubmitButton name="decision" value="rechazar" variant="outline" className="h-11 flex-1 text-base">Rechazar</SubmitButton>
        </div>
      )}
    </>
  );

  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-xs", p.status === "rechazada" && "opacity-60")}>
      {open ? (
        <ActionForm action={decideProposalAction.bind(null, slug, p.id)} className="space-y-3">{content}</ActionForm>
      ) : (
        <div className="space-y-3">{content}</div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
