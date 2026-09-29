import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import {
  addressStatus,
  assetKind,
  assetOperation,
  assetPartyRole,
  companyKind,
  consentStatus,
  contactKind,
  contactPermission,
  contactRelation,
  entityKind,
  evidenceOrigin,
  evidenceType,
  targetStatus,
  taskStatus,
  verificationStatus,
} from "@/domain/catalogs";
import { isStale, knowledgeGroup, type KnowledgeGroup } from "@/domain/evidence";
import { companyName, entityFk, entityHref, entityTable, isEntityKind } from "@/server/entities";
import { DemoBadge, EmptyState, PageHeader, Pill, Section, StatusBadges, VerificationBadge, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxGroup, SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { MapsButton } from "@/components/app/maps-button";
import { EntityFields, SourcePicker } from "@/components/explorar/entity-fields";
import { updateEntity, updateTarget } from "../../../explorar/actions";
import { addAssetParty, addContact, addEvidence, updateEvidenceStatus } from "../../actions";
import { findingSelect, profileNames, toFindingRow } from "@/server/findings";
import { FindingCard } from "@/components/oportunidades/finding-card";
import { FindingForm } from "@/components/oportunidades/finding-form";
import { createFinding } from "../../../oportunidades/actions";

type Row = Record<string, unknown> & { id: string; is_demo: boolean; verification_status: string; source_id: string | null };

const fieldLabels: Record<string, string> = {
  trade_name: "nombre comercial",
  legal_name: "razón social",
  name: "nombre",
  title: "título",
  kind: "tipo",
  status: "etapa",
  verification_status: "verificación",
  address_text: "dirección",
  address_status: "estado de dirección",
  public_phone: "teléfono",
  website: "sitio web",
  price_amount: "precio",
  next_action: "próxima acción",
  next_action_due: "fecha de próxima acción",
  priority: "prioridad",
  notes: "notas",
};

const groupTitle: Record<KnowledgeGroup, string> = {
  sabemos: "Qué sabemos · verificado",
  creemos: "Qué creemos · sin verificar o parcial",
  en_duda: "En duda · contradicho o desactualizado",
};

function todayAR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

const opts = (c: { values: readonly string[]; label: (v: string) => string }) => c.values.map((v) => ({ value: v, label: c.label(v) }));
const priorityLabel: Record<number, string> = { 1: "Alta", 2: "Media", 3: "Baja" };

// Company Intelligence (V13 §5.1): qué sigue, qué sabemos y de dónde salió, quiénes importan,
// qué pasó. Sirve para empresas, establecimientos y activos.
export default async function EntityPage({ params }: PageProps<"/w/[slug]/e/[kind]/[id]">) {
  const { slug, kind, id } = await params;
  if (!isEntityKind(kind)) notFound();
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const today = todayAR();
  const base = `/w/${slug}`;

  const { data: entity } = await supabase.from(entityTable[kind]).select("*").eq("id", id).maybeSingle<Row>();
  if (!entity) notFound();

  const fk = entityFk[kind];
  const [
    { data: targets },
    { data: evidence },
    { data: links },
    { data: sources },
    { data: companies },
    { data: allVerticals },
    { data: history },
    { data: refs },
    { data: rawFindings },
  ] = await Promise.all([
    supabase
      .from("campaign_targets")
      .select("id, status, priority, owner_id, next_action, next_action_due, discard_reason, campaigns(id, name), target_verticals(vertical_id, verticals(name)), visits(id, visited_at, interlocutor_name, consent_status, notes, is_demo)")
      .eq(fk, id),
    supabase
      .from("evidence")
      .select("id, statement, quote, evidence_type, verification_status, origin_kind, observed_at, revalidate_after, next_verification_step, created_at, created_by, is_demo, capture_id, visit_id, declared_by, sources(id, title, url), stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(id, full_name)")
      .eq(fk, id)
      .order("observed_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("contact_links")
      .select("relation, contacts(id, full_name, contact_kind, role_title, email, phone, contact_permission, introduced_by, verification_status, is_demo)")
      .eq(fk, id),
    supabase.from("sources").select("id, title, url").order("captured_at", { ascending: false }).limit(300),
    supabase.from("companies").select("id, trade_name, legal_name").order("trade_name"),
    supabase.from("verticals").select("id, name").eq("status", "activa").order("name"),
    supabase.from("audit_log").select("id, action, changes, created_at, actor_id").eq("entity_id", id).order("id", { ascending: false }).limit(20),
    supabase.from("external_refs").select("source_system, external_id, sheet, row_number, first_imported_at, last_imported_at, last_batch_id").eq("entity_id", id),
    supabase.from("findings").select(findingSelect).eq(fk, id).order("created_at", { ascending: false }),
  ]);
  // Si nació de una captura: la propuesta aceptada que la creó (IA propone → humano promueve).
  const { data: fromCapture } = await supabase.from("proposals").select("capture_id, status, decided_by, decided_at").eq("result_id", id).in("status", ["aceptada", "editada"]).limit(1).maybeSingle();

  const targetIds = (targets ?? []).map((t) => t.id);
  const contactIds = (links ?? []).flatMap((l) => (l.contacts ? [l.contacts.id] : []));
  const followUpFilter = [
    targetIds.length ? `target_id.in.(${targetIds.join(",")})` : null,
    contactIds.length ? `contact_id.in.(${contactIds.join(",")})` : null,
  ].filter(Boolean).join(",");
  const [{ data: followUps }, parties, children] = await Promise.all([
    followUpFilter
      ? supabase.from("tasks").select("id, title, status, due_on, kind, channel, assignee_id, contacts(full_name)").or(followUpFilter).order("due_on", { nullsFirst: false })
      : Promise.resolve({ data: [] as { id: string; title: string; status: string; due_on: string | null; kind: string | null; channel: string | null; assignee_id: string | null; contacts: { full_name: string } | null }[] }),
    kind === "asset"
      ? supabase.from("asset_parties").select("id, role, verification_status, notes, companies(id, trade_name, legal_name), contacts(id, full_name)").eq("asset_id", id)
      : kind === "company"
        ? supabase.from("asset_parties").select("id, role, verification_status, notes, assets(id, title)").eq("company_id", id)
        : Promise.resolve({ data: null }),
    kind === "company" ? supabase.from("establishments").select("id, name").eq("company_id", id) : Promise.resolve({ data: null }),
  ]);

  const findings = (rawFindings ?? []).map(toFindingRow);
  const people = await profileNames(supabase, [
    ...findings.flatMap((f) => [f.created_by, f.reviewed_by]),
    ...(history ?? []).map((h) => h.actor_id),
    ...(evidence ?? []).map((e) => e.created_by),
    ...(targets ?? []).map((t) => t.owner_id),
    ...(followUps ?? []).map((t) => t.assignee_id),
  ]);
  const nameOf = (uid: string | null | undefined) => (uid ? people.get(uid) ?? "usuario" : null);
  const sourceById = new Map((sources ?? []).map((s) => [s.id, s]));
  const sourceOptions = (sources ?? []).map((s) => ({ value: s.id, label: s.url ? `${s.title} — ${new URL(s.url).hostname}` : s.title }));
  const companyOptions = (companies ?? []).filter((c) => c.id !== id).map((c) => ({ value: c.id, label: companyName(c) }));
  const verticalOptions = (allVerticals ?? []).map((v) => ({ value: v.id, label: v.name }));

  const title =
    kind === "company"
      ? companyName(entity as unknown as { trade_name: string | null; legal_name: string | null })
      : kind === "establishment"
        ? String(entity.name)
        : String(entity.title);
  const place =
    kind === "company"
      ? null
      : {
          address_text: entity.address_text as string | null,
          locality: entity.locality as string | null,
          province: entity.province as string | null,
          country: entity.country as string | null,
          address_status: String(entity.address_status),
          latitude: entity.latitude as number | null,
          longitude: entity.longitude as number | null,
        };
  const mainSource = entity.source_id ? sourceById.get(entity.source_id) : null;
  const priceSource = entity.price_source_id ? sourceById.get(entity.price_source_id as string) : null;
  const visits = (targets ?? []).flatMap((t) => t.visits.map((v) => ({ ...v, campaign: t.campaigns?.name })));
  visits.sort((a, b) => b.visited_at.localeCompare(a.visited_at));

  let parentCompany: { id: string; trade_name: string | null; legal_name: string | null } | null = null;
  if (kind === "establishment" && entity.company_id) {
    const { data } = await supabase.from("companies").select("id, trade_name, legal_name").eq("id", entity.company_id as string).maybeSingle();
    parentCompany = data;
  }

  const grouped: Record<KnowledgeGroup, NonNullable<typeof evidence>> = { sabemos: [], creemos: [], en_duda: [] };
  for (const e of evidence ?? []) grouped[knowledgeGroup(e, today)].push(e);
  const openFollowUps = (followUps ?? []).filter((t) => t.status !== "done");
  const imported = (refs ?? [])[0];

  return (
    <>
      <PageHeader
        back={<Link href={`${base}/explorar/registros`} className="hover:underline">← Registros</Link>}
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {kind === "asset" ? assetKind.label(String(entity.kind)) : entityKind.label(kind)}
            <StatusBadges verification={entity.verification_status} isDemo={entity.is_demo} />
            {(targets ?? []).map((t) => (
              <Pill key={t.id}>{targetStatus.label(t.status)} · prioridad {priorityLabel[t.priority] ?? t.priority}</Pill>
            ))}
            {imported && <Pill>CRM {imported.external_id}</Pill>}
          </span>
        }
        actions={
          <>
            <MapsButton place={place} />
            <Link href={`${base}/ai?scope=${kind}:${id}`} className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted">Preguntar a RELEVO AI</Link>
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {/* Qué sigue */}
          <Section title="Qué sigue">
            {(targets ?? []).length === 0 && openFollowUps.length === 0 ? (
              <EmptyState title="Sin próxima acción">Agregalo a la misión para definir etapa, responsable y próxima acción.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {(targets ?? []).map((t) => {
                  const overdue = !!t.next_action_due && t.next_action_due < today;
                  return (
                    <li key={t.id} className="rounded-xl border bg-card p-4 shadow-xs">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{t.next_action ?? <span className="text-destructive">Sin próxima acción definida</span>}</p>
                          <p className={overdue ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                            {[nameOf(t.owner_id) ?? "sin responsable", t.next_action_due ? `${overdue ? "vencida " : ""}${formatDate(t.next_action_due)}` : "sin fecha", t.campaigns?.name].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        {ctx.canEdit && (
                          <Link href={`${base}/agenda/visita?target=${t.id}`} className="inline-flex h-10 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/85">Registrar visita</Link>
                        )}
                      </div>
                      {ctx.canEdit && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm text-primary">Actualizar etapa y próxima acción</summary>
                          <ActionForm action={updateTarget.bind(null, slug, t.id)} className="mt-3">
                            <div className="grid gap-3 sm:grid-cols-3">
                              <SelectField name="status" label="Etapa" defaultValue={t.status} options={opts(targetStatus)} />
                              <SelectField name="priority" label="Prioridad" defaultValue={String(t.priority)} options={[{ value: "1", label: "Alta" }, { value: "2", label: "Media" }, { value: "3", label: "Baja" }]} />
                              <TextField name="next_action_due" label="Fecha próxima acción" type="date" defaultValue={t.next_action_due ?? ""} />
                            </div>
                            <TextField name="next_action" label="Próxima acción" defaultValue={t.next_action ?? ""} />
                            <TextField name="discard_reason" label="Motivo de descarte" defaultValue={t.discard_reason ?? ""} />
                            <CheckboxGroup name="vertical_ids" label="Categorías" options={verticalOptions} defaultValues={t.target_verticals.map((v) => v.vertical_id)} />
                            <SubmitButton variant="outline">Guardar</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                    </li>
                  );
                })}
                {openFollowUps.map((f) => (
                  <li key={f.id} className="rounded-xl border border-dashed p-4 text-sm">
                    <p className="font-medium">{f.title}</p>
                    <p className={f.due_on && f.due_on < today ? "text-destructive" : "text-muted-foreground"}>
                      {[f.kind, f.channel, f.contacts?.full_name ? `con ${f.contacts.full_name}` : null, nameOf(f.assignee_id), f.due_on ? formatDate(f.due_on) : "sin fecha", taskStatus.label(f.status)].filter(Boolean).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Qué sabemos */}
          <Section title="Qué sabemos y de dónde salió">
            {(evidence ?? []).length === 0 && <EmptyState title="Todavía no hay evidencia">Capturá lo que viste o escuchaste, o registrá un dato con su fuente.</EmptyState>}
            {(["sabemos", "creemos", "en_duda"] as const).map((g) =>
              grouped[g].length ? (
                <div key={g} className="space-y-2">
                  <h3 className="text-sm font-medium">{groupTitle[g]} ({grouped[g].length})</h3>
                  <ul className="divide-y rounded-xl border bg-card shadow-xs">
                    {grouped[g].map((e) => (
                      <li key={e.id} className="space-y-1.5 p-4">
                        <p className="text-sm">{e.statement}</p>
                        {e.quote && <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">“{e.quote}”</blockquote>}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <VerificationBadge status={isStale(e, today) && e.verification_status !== "stale" ? "stale" : e.verification_status} />
                          <DemoBadge show={e.is_demo} />
                          <span>{evidenceType.label(e.evidence_type)} · {evidenceOrigin.label(e.origin_kind)}</span>
                          {e.stated_by && <span>· dicho por {e.stated_by.full_name}</span>}
                          {e.declared_by && <span>· declarado por {e.declared_by}</span>}
                          {e.sources ? (
                            e.sources.url ? (
                              <a href={e.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">· {e.sources.title}</a>
                            ) : (
                              <span>· {e.sources.title}</span>
                            )
                          ) : null}
                          {e.capture_id && <Link href={`${base}/capturas/${e.capture_id}`} className="text-primary hover:underline">· captura original</Link>}
                          {e.visit_id && <Link href={`${base}/agenda/visita/${e.visit_id}`} className="text-primary hover:underline">· visita</Link>}
                          {!e.sources && !e.capture_id && !e.visit_id && <span>· sin fuente</span>}
                          <span>· {formatDate(e.observed_at ?? e.created_at)}{e.created_by ? ` · cargó ${nameOf(e.created_by)}` : ""}</span>
                          {e.revalidate_after && <span>· revalidar {formatDate(e.revalidate_after)}</span>}
                        </div>
                        {e.next_verification_step && <p className="text-xs">Para verificar: {e.next_verification_step}</p>}
                        {ctx.canEdit && (
                          <ActionForm action={updateEvidenceStatus.bind(null, slug, e.id)} className="flex items-end gap-2 space-y-0">
                            <SelectField name="verification_status" label="Verificación" className="w-56" defaultValue={e.verification_status} options={opts(verificationStatus)} />
                            <SubmitButton variant="outline">Aplicar</SubmitButton>
                          </ActionForm>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Registrar evidencia</summary>
                <ActionForm action={addEvidence.bind(null, slug)} resetOnSuccess className="mt-4">
                  <input type="hidden" name="entity_kind" value={kind} />
                  <input type="hidden" name="entity_id" value={id} />
                  <TextAreaField name="statement" label="Qué sabemos" rows={2} placeholder="Un dato concreto. Ej.: Tienen 40 camionetas en la base de Añelo." />
                  <TextAreaField name="quote" label="Cita textual (opcional)" rows={2} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SelectField name="evidence_type" label="Tipo" defaultValue="dato" options={opts(evidenceType)} />
                    <SelectField name="origin_kind" label="Origen" defaultValue="manual" options={opts(evidenceOrigin)} />
                    <SelectField name="verification_status" label="Verificación" defaultValue="unverified" options={opts(verificationStatus)} />
                  </div>
                  <SourcePicker sources={sourceOptions} />
                  <TextField name="next_verification_step" label="Próximo paso para verificar" />
                  <SubmitButton>Registrar evidencia</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>

          {/* Findings */}
          <Section title={`Findings (${findings.length})`}>
            <div className="space-y-3">
              {findings.map((f) => <FindingCard key={f.id} f={f} slug={slug} canEdit={ctx.canEdit} names={people} />)}
            </div>
            {!findings.length && <p className="text-sm text-muted-foreground">Sin findings sobre este registro. Un finding se promueve desde la evidencia, no se fabrica.</p>}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Nuevo finding</summary>
                <div className="mt-4">
                  <FindingForm action={createFinding.bind(null, slug)} sources={sourceOptions} defaultEntity={`${kind}:${id}`} />
                </div>
              </details>
            )}
          </Section>

          {/* Qué pasó */}
          <Section title="Qué pasó">
            {visits.length || (followUps ?? []).some((f) => f.status === "done") ? (
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {visits.map((v) => (
                  <li key={v.id} className="space-y-1 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link href={`${base}/agenda/visita/${v.id}`} className="font-medium hover:underline">Visita · {formatDate(v.visited_at, true)}</Link>
                      {v.interlocutor_name && <span className="text-muted-foreground">con {v.interlocutor_name}</span>}
                      <Pill>Consentimiento: {consentStatus.label(v.consent_status)}</Pill>
                      <DemoBadge show={v.is_demo} />
                    </div>
                    <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{v.notes}</p>
                  </li>
                ))}
                {(followUps ?? []).filter((f) => f.status === "done").map((f) => (
                  <li key={f.id} className="p-4 text-sm text-muted-foreground">Hecho · {f.title}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no hay visitas ni actividades cerradas.</p>
            )}
          </Section>

          {/* Activos y partes */}
          {kind === "asset" && (
            <Section title="Partes del activo">
              <p className="text-xs text-muted-foreground">Quien publica un activo no es necesariamente su propietario: cada rol se registra aparte y con su verificación.</p>
              {parties.data?.length ? (
                <ul className="divide-y rounded-xl border bg-card shadow-xs">
                  {(parties.data as { id: string; role: string; verification_status: string; notes: string | null; companies?: { id: string; trade_name: string | null; legal_name: string | null } | null; contacts?: { id: string; full_name: string } | null }[]).map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <Pill>{assetPartyRole.label(p.role)}</Pill>
                      {p.companies ? <Link href={entityHref(slug, "company", p.companies.id)} className="font-medium hover:underline">{companyName(p.companies)}</Link> : <span className="font-medium">{p.contacts?.full_name}</span>}
                      <VerificationBadge status={p.verification_status} />
                      {p.notes && <span className="text-muted-foreground">· {p.notes}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Sin partes registradas.</p>
              )}
              {ctx.canEdit && (
                <details className="rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">+ Parte</summary>
                  <ActionForm action={addAssetParty.bind(null, slug, id)} resetOnSuccess className="mt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SelectField name="role" label="Rol" options={opts(assetPartyRole)} />
                      <SelectField name="party" label="Empresa" options={companyOptions.map((c) => ({ value: `company:${c.value}`, label: c.label }))} placeholder="— Elegí —" />
                    </div>
                    <TextField name="notes" label="Nota (opcional)" />
                    <SubmitButton>Agregar</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Section>
          )}
          {kind === "company" && (parties.data?.length || children.data?.length) ? (
            <Section title="Establecimientos y activos">
              <div className="flex flex-wrap gap-2 text-sm">
                {children.data?.map((e) => <Link key={e.id} href={entityHref(slug, "establishment", e.id)} className="rounded-md border px-2 py-1 hover:bg-muted">Establecimiento · {e.name}</Link>)}
                {(parties.data as { id: string; role: string; assets?: { id: string; title: string } | null }[] | null)?.map((p) =>
                  p.assets ? <Link key={p.id} href={entityHref(slug, "asset", p.assets.id)} className="rounded-md border px-2 py-1 hover:bg-muted">{assetPartyRole.label(p.role)} · {p.assets.title}</Link> : null,
                )}
              </div>
            </Section>
          ) : null}

          {/* Datos */}
          <Section title="Datos">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {kind === "company" && (
                <>
                  <Item label="Razón social" value={entity.legal_name as string} />
                  <Item label="Rol" value={companyKind.label(entity.kind as string)} />
                  <Item label="Localidad" value={entity.locality as string} />
                  <Item label="Teléfono público" value={entity.public_phone as string} />
                  <Item label="Sitio web" value={entity.website as string} link />
                  <Item label="Carpeta en Drive" value={entity.drive_folder_url as string} link />
                </>
              )}
              {place && (
                <>
                  <Item label="Dirección" value={[place.address_text, place.locality, place.province].filter(Boolean).join(", ")} />
                  <Item label="Estado de dirección" value={addressStatus.label(place.address_status)} />
                  {place.latitude != null && <Item label="Coordenadas" value={`${place.latitude}, ${place.longitude}`} />}
                </>
              )}
              {kind === "asset" && (
                <>
                  <Item label="Operación" value={assetOperation.label(entity.operation as string)} />
                  <Item label="Superficie" value={entity.surface_m2 != null ? `${entity.surface_m2} m²` : null} />
                  <Item
                    label="Precio publicado"
                    value={
                      entity.price_amount != null
                        ? `${entity.price_currency} ${Number(entity.price_amount).toLocaleString("es-AR")} · ${formatDate(entity.price_observed_on as string)}${priceSource ? ` · ${priceSource.title}` : ""}`
                        : "Sin dato"
                    }
                  />
                </>
              )}
              {parentCompany && (
                <div>
                  <dt className="text-muted-foreground">Empresa</dt>
                  <dd><Link href={entityHref(slug, "company", parentCompany.id)} className="text-primary hover:underline">{companyName(parentCompany)}</Link></dd>
                </div>
              )}
              <Item label="Categorías" value={[...new Set((targets ?? []).flatMap((t) => t.target_verticals.map((v) => v.verticals?.name).filter(Boolean)))].join(", ") || null} />
            </dl>
            {Boolean(entity.notes) && <p className="text-sm whitespace-pre-wrap">{String(entity.notes)}</p>}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">Editar datos</summary>
                <ActionForm action={updateEntity.bind(null, slug, kind, id)} className="mt-4">
                  <EntityFields kind={kind} sources={sourceOptions} companies={companyOptions} d={entity as Record<string, string | number | boolean | null>} />
                  <SubmitButton>Guardar cambios</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>
        </div>

        <aside className="space-y-8">
          <Section title="De dónde salió">
            <dl className="space-y-2 text-sm">
              {fromCapture && (
                <div>
                  <dt className="text-muted-foreground">Captura de campo</dt>
                  <dd>
                    <Link href={`${base}/capturas/${fromCapture.capture_id}`} className="text-primary hover:underline">Ver la captura original</Link>
                    <span className="block text-xs text-muted-foreground">Propuesta por RELEVO, {fromCapture.status === "editada" ? "editada y " : ""}aceptada {formatDate(fromCapture.decided_at, true)}</span>
                  </dd>
                </div>
              )}
              {(refs ?? []).length ? (
                (refs ?? []).map((r) => (
                  <div key={`${r.source_system}-${r.external_id}`}>
                    <dt className="text-muted-foreground">CRM de Sheets</dt>
                    <dd>
                      {r.external_id}
                      {r.sheet ? ` · ${r.sheet}${r.row_number ? `, fila ${r.row_number}` : ""}` : ""}
                      <span className="block text-xs text-muted-foreground">
                        Importado {formatDate(r.first_imported_at, true)}
                        {Date.parse(r.last_imported_at) - Date.parse(r.first_imported_at) > 60_000 ? ` · última reimportación ${formatDate(r.last_imported_at, true)}` : ""}
                      </span>
                      {r.last_batch_id && (
                        <Link href={`${base}/integraciones/importar/${r.last_batch_id}`} className="text-xs text-primary hover:underline">
                          Ver el lote y sus decisiones
                        </Link>
                      )}
                    </dd>
                  </div>
                ))
              ) : fromCapture ? null : (
                <div>
                  <dt className="text-muted-foreground">Origen</dt>
                  <dd>Cargado en RELEVO</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Fuente principal</dt>
                <dd>
                  {mainSource ? (
                    mainSource.url ? <a href={mainSource.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{mainSource.title}</a> : mainSource.title
                  ) : (
                    <span className="text-muted-foreground">Sin fuente registrada</span>
                  )}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Quiénes importan">
            {links?.length ? (
              <ul className="space-y-2">
                {links.map((l) =>
                  l.contacts ? (
                    <li key={l.contacts.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {l.contacts.full_name}
                        {l.contacts.contact_kind === "canal_institucional" && <Pill>{contactKind.label(l.contacts.contact_kind)}</Pill>}
                        <DemoBadge show={l.contacts.is_demo} />
                      </div>
                      <div className="text-muted-foreground">{[contactRelation.label(l.relation), l.contacts.role_title].filter(Boolean).join(" · ")}</div>
                      <div className="mt-1 text-xs">{contactPermission.label(l.contacts.contact_permission)}</div>
                      {l.contacts.introduced_by && <div className="text-xs text-muted-foreground">Intro: {l.contacts.introduced_by}</div>}
                      <ContactLinks phone={l.contacts.phone} email={l.contacts.email} />
                      <div className="mt-1"><VerificationBadge status={l.contacts.verification_status} /></div>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin personas vinculadas.</p>
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">+ Persona o canal</summary>
                <ActionForm action={addContact.bind(null, slug)} resetOnSuccess className="mt-3">
                  <input type="hidden" name="link_kind" value={kind} />
                  <input type="hidden" name="link_id" value={id} />
                  <SelectField name="contact_kind" label="Es" defaultValue="persona" options={opts(contactKind)} />
                  <TextField name="full_name" label="Nombre (o área, si es un canal)" />
                  <SelectField name="relation" label="Relación" defaultValue="otro" options={opts(contactRelation)} />
                  <TextField name="role_title" label="Cargo" />
                  <SelectField name="contact_permission" label="¿Se puede contactar?" defaultValue="sin_definir" options={opts(contactPermission)} />
                  <TextField name="introduced_by" label="Quién puede presentarnos" />
                  <TextField name="phone" label="Teléfono" hint="Solo si lo aportó legítimamente; requiere fuente." />
                  <TextField name="email" label="Email" type="email" />
                  <SelectField name="verification_status" label="Verificación" defaultValue="unverified" options={opts(verificationStatus)} />
                  <SourcePicker sources={sourceOptions} />
                  <SubmitButton>Guardar</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>

          <Section title="Historial">
            {history?.length ? (
              <ol className="space-y-2 text-xs">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 pl-3">
                    <div className="text-muted-foreground">{formatDate(h.created_at, true)} · {nameOf(h.actor_id) ?? "sistema"}</div>
                    <div>
                      {h.action === "insert"
                        ? "Creado"
                        : h.action === "delete"
                          ? "Eliminado"
                          : `Cambió ${Object.keys((h.changes as Record<string, unknown>) ?? {}).map((k) => fieldLabels[k] ?? k).join(", ")}`}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}

function ContactLinks({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return null;
  const digits = phone?.replace(/[^\d+]/g, "") ?? "";
  const items: ReactNode[] = [];
  if (phone) {
    items.push(<a key="tel" href={`tel:${digits}`} className="text-primary hover:underline">Llamar</a>);
    items.push(<a key="wa" href={`https://wa.me/${digits.replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">WhatsApp</a>);
  }
  if (email) items.push(<a key="mail" href={`mailto:${email}`} className="text-primary hover:underline">{email}</a>);
  return <div className="mt-1 flex flex-wrap gap-x-3 text-xs">{phone && <span>{phone}</span>}{items}</div>;
}

function Item({ label, value, link = false }: { label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {value ? (
          link ? (
            <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{value}</a>
          ) : (
            value
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}
