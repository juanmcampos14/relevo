import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import {
  addressStatus,
  assetKind,
  assetOperation,
  companyKind,
  consentStatus,
  contactPermission,
  contactRelation,
  entityKind,
  targetStatus,
  verificationStatus,
} from "@/domain/catalogs";
import { companyName, entityFk, entityHref, entityTable, isEntityKind } from "@/server/entities";
import { DemoBadge, EmptyState, PageHeader, Pill, Section, StatusBadges, VerificationBadge, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CheckboxGroup, SelectField, TextAreaField, TextField } from "@/components/app/fields";
import { MapsButton } from "@/components/app/maps-button";
import { EntityFields, SourcePicker } from "@/components/explorar/entity-fields";
import { updateEntity, updateTarget } from "../../../explorar/actions";
import { addClaim, addContact, updateClaimStatus } from "../../actions";
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
  status: "estado",
  verification_status: "verificación",
  address_text: "dirección",
  address_status: "estado de dirección",
  price_amount: "precio",
  next_action: "próxima acción",
  priority: "prioridad",
  notes: "notas",
};

export default async function EntityPage({ params }: PageProps<"/w/[slug]/e/[kind]/[id]">) {
  const { slug, kind, id } = await params;
  if (!isEntityKind(kind)) notFound();
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();

  const { data: entity } = await supabase.from(entityTable[kind]).select("*").eq("id", id).maybeSingle<Row>();
  if (!entity) notFound();

  const fk = entityFk[kind];
  const [
    { data: targets },
    { data: claims },
    { data: links },
    { data: sources },
    { data: companies },
    { data: allVerticals },
    { data: history },
  ] = await Promise.all([
    supabase
      .from("campaign_targets")
      .select("id, status, priority, next_action, next_action_due, discard_reason, campaigns(id, name), target_verticals(vertical_id), visits(id, visited_at, interlocutor_name, consent_status, notes, is_demo)")
      .eq(fk, id),
    supabase.from("claims").select("id, statement, verification_status, next_verification_step, created_at, sources(id, title, url)").eq(fk, id).order("created_at", { ascending: false }),
    supabase
      .from("contact_links")
      .select("relation, contacts(id, full_name, role_title, email, phone, contact_permission, introduced_by, verification_status, is_demo)")
      .eq(fk, id),
    supabase.from("sources").select("id, title, url").order("captured_at", { ascending: false }).limit(300),
    supabase.from("companies").select("id, trade_name, legal_name").order("trade_name"),
    supabase.from("verticals").select("id, name").eq("status", "activa").order("name"),
    supabase.from("audit_log").select("id, action, changes, created_at, actor_id").eq("entity_id", id).order("id", { ascending: false }).limit(15),
  ]);

  const [{ data: rawFindings }] = await Promise.all([
    supabase.from("findings").select(findingSelect).eq(fk, id).order("created_at", { ascending: false }),
  ]);
  const findings = (rawFindings ?? []).map(toFindingRow);
  const findingNames = await profileNames(supabase, findings.flatMap((f) => [f.created_by, f.reviewed_by]));
  const sourceById = new Map((sources ?? []).map((s) => [s.id, s]));
  const sourceOptions = (sources ?? []).map((s) => ({ value: s.id, label: s.url ? `${s.title} — ${new URL(s.url).hostname}` : s.title }));
  const companyOptions = (companies ?? []).filter((c) => c.id !== id).map((c) => ({ value: c.id, label: companyName(c) }));
  const verticalOptions = (allVerticals ?? []).map((v) => ({ value: v.id, label: v.name }));
  const actorIds = [...new Set((history ?? []).map((h) => h.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("user_id, display_name, email").in("user_id", actorIds)
    : { data: [] };
  const actorName = new Map((actors ?? []).map((a) => [a.user_id, a.display_name || a.email]));

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
  const parentId = (kind === "establishment" ? entity.company_id : kind === "asset" ? entity.owner_company_id : null) as string | null;
  if (parentId) {
    const { data } = await supabase.from("companies").select("id, trade_name, legal_name").eq("id", parentId).maybeSingle();
    parentCompany = data;
  }
  const children =
    kind === "company"
      ? await Promise.all([
          supabase.from("establishments").select("id, name").eq("company_id", id),
          supabase.from("assets").select("id, title").eq("owner_company_id", id),
        ])
      : null;

  return (
    <>
      <PageHeader
        back={<Link href={`/w/${slug}/explorar/registros`} className="hover:underline">← Registros</Link>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {kind === "asset" ? assetKind.label(String(entity.kind)) : entityKind.label(kind)}
            <StatusBadges verification={entity.verification_status} isDemo={entity.is_demo} />
            {mainSource && (
              <span>
                Fuente:{" "}
                {mainSource.url ? (
                  <a href={mainSource.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{mainSource.title}</a>
                ) : (
                  mainSource.title
                )}
              </span>
            )}
            {!mainSource && <span>Sin fuente registrada</span>}
          </span>
        }
        actions={<MapsButton place={place} />}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {/* Datos principales */}
          <Section title="Datos">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {kind === "company" && (
                <>
                  <Item label="Razón social" value={entity.legal_name as string} />
                  <Item label="Rol" value={companyKind.label(entity.kind as string)} />
                  <Item label="Localidad" value={entity.locality as string} />
                  <Item label="Sitio web" value={entity.website as string} link />
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
                  <dt className="text-muted-foreground">{kind === "asset" ? "Titular" : "Empresa"}</dt>
                  <dd><Link href={entityHref(slug, "company", parentCompany.id)} className="text-primary hover:underline">{companyName(parentCompany)}</Link></dd>
                </div>
              )}
            </dl>
            {Boolean(entity.notes) && <p className="text-sm whitespace-pre-wrap">{String(entity.notes)}</p>}
            {children && (children[0].data?.length || children[1].data?.length) ? (
              <div className="flex flex-wrap gap-2 text-sm">
                {children[0].data?.map((e) => <Link key={e.id} href={entityHref(slug, "establishment", e.id)} className="rounded-md border px-2 py-1 hover:bg-muted">Establecimiento · {e.name}</Link>)}
                {children[1].data?.map((a) => <Link key={a.id} href={entityHref(slug, "asset", a.id)} className="rounded-md border px-2 py-1 hover:bg-muted">Activo · {a.title}</Link>)}
              </div>
            ) : null}
          </Section>

          {/* Campañas */}
          <Section title="En campañas">
            {targets?.length ? (
              <ul className="space-y-3">
                {targets.map((t) => (
                  <li key={t.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/w/${slug}/explorar/c/${t.campaigns?.id}`} className="font-medium hover:underline">{t.campaigns?.name}</Link>
                      <div className="flex gap-2">
                        <Pill>{targetStatus.label(t.status)}</Pill>
                        {ctx.canEdit && (
                          <Link href={`/w/${slug}/agenda/visita?target=${t.id}`} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/85">Registrar visita</Link>
                        )}
                      </div>
                    </div>
                    {t.next_action && <p className="mt-1 text-sm text-muted-foreground">Próxima acción: {t.next_action} {t.next_action_due && `(${formatDate(t.next_action_due)})`}</p>}
                    {ctx.canEdit && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm text-primary">Actualizar estado</summary>
                        <ActionForm action={updateTarget.bind(null, slug, t.id)} className="mt-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <SelectField name="status" label="Estado" defaultValue={t.status} options={targetStatus.values.map((v) => ({ value: v, label: targetStatus.label(v) }))} />
                            <SelectField name="priority" label="Prioridad" defaultValue={String(t.priority)} options={[{ value: "1", label: "Alta" }, { value: "2", label: "Media" }, { value: "3", label: "Baja" }]} />
                            <TextField name="next_action_due" label="Fecha próxima acción" type="date" defaultValue={t.next_action_due ?? ""} />
                          </div>
                          <TextField name="next_action" label="Próxima acción" defaultValue={t.next_action ?? ""} />
                          <TextField name="discard_reason" label="Motivo de descarte" defaultValue={t.discard_reason ?? ""} />
                          <CheckboxGroup name="vertical_ids" label="Verticales" options={verticalOptions} defaultValues={t.target_verticals.map((v) => v.vertical_id)} />
                          <SubmitButton variant="outline">Guardar</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No está en ninguna campaña">Agregalo desde la campaña con “Ya cargado”.</EmptyState>
            )}
          </Section>

          {/* Afirmaciones */}
          <Section title="Afirmaciones y verificación">
            {claims?.length ? (
              <ul className="divide-y rounded-lg border">
                {claims.map((c) => (
                  <li key={c.id} className="space-y-1.5 p-4">
                    <p className="text-sm">{c.statement}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <VerificationBadge status={c.verification_status} />
                      {c.sources ? (
                        c.sources.url ? (
                          <a href={c.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{c.sources.title}</a>
                        ) : (
                          <span>{c.sources.title}</span>
                        )
                      ) : (
                        <span>Sin fuente</span>
                      )}
                      <span>· {formatDate(c.created_at)}</span>
                    </div>
                    {c.next_verification_step && <p className="text-xs">Para verificar: {c.next_verification_step}</p>}
                    {ctx.canEdit && (
                      <ActionForm action={updateClaimStatus.bind(null, slug, c.id)} className="flex items-end gap-2 space-y-0">
                        <SelectField
                          name="verification_status"
                          label="Cambiar estado"
                          className="w-56"
                          defaultValue={c.verification_status}
                          options={verificationStatus.values.map((v) => ({ value: v, label: verificationStatus.label(v) }))}
                        />
                        <SubmitButton variant="outline">Aplicar</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sin afirmaciones registradas" />
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Nueva afirmación</summary>
                <ActionForm action={addClaim.bind(null, slug)} resetOnSuccess className="mt-4">
                  <input type="hidden" name="entity_kind" value={kind} />
                  <input type="hidden" name="entity_id" value={id} />
                  <TextAreaField name="statement" label="Afirmación" rows={2} placeholder="Ej.: El dueño dice que busca socio para abrir un segundo local." />
                  <SelectField name="verification_status" label="Estado" defaultValue="hipotesis" options={verificationStatus.values.map((v) => ({ value: v, label: verificationStatus.label(v) }))} />
                  <SourcePicker sources={sourceOptions} />
                  <TextField name="next_verification_step" label="Próximo paso para verificar" />
                  <SubmitButton>Registrar afirmación</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>

          {/* Hallazgos */}
          <Section title={`Hallazgos (${findings.length})`}>
            <div className="space-y-3">
              {findings.map((f) => <FindingCard key={f.id} f={f} slug={slug} canEdit={ctx.canEdit} names={findingNames} />)}
            </div>
            {!findings.length && <EmptyState title="Sin hallazgos sobre este registro" />}
            {ctx.canEdit && (
              <details className="rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">+ Nuevo hallazgo</summary>
                <div className="mt-4">
                  <FindingForm action={createFinding.bind(null, slug)} sources={sourceOptions} defaultEntity={`${kind}:${id}`} />
                </div>
              </details>
            )}
          </Section>

          {/* Visitas */}
          <Section title="Visitas">
            {visits.length ? (
              <ul className="divide-y rounded-lg border">
                {visits.map((v) => (
                  <li key={v.id} className="space-y-1 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link href={`/w/${slug}/agenda/visita/${v.id}`} className="font-medium hover:underline">{formatDate(v.visited_at, true)}</Link>
                      <span className="text-muted-foreground">{v.campaign}</span>
                      {v.interlocutor_name && <span className="text-muted-foreground">· con {v.interlocutor_name}</span>}
                      <Pill>Consentimiento: {consentStatus.label(v.consent_status)}</Pill>
                      <DemoBadge show={v.is_demo} />
                    </div>
                    <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{v.notes}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Todavía no hay visitas registradas" />
            )}
          </Section>

          {ctx.canEdit && (
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Editar datos</summary>
              <ActionForm action={updateEntity.bind(null, slug, kind, id)} className="mt-4">
                <EntityFields kind={kind} sources={sourceOptions} companies={companyOptions} d={entity as Record<string, string | number | boolean | null>} />
                <SubmitButton>Guardar cambios</SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>

        <aside className="space-y-8">
          <Section title="Contactos">
            {links?.length ? (
              <ul className="space-y-2">
                {links.map((l) =>
                  l.contacts ? (
                    <li key={l.contacts.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {l.contacts.full_name}
                        <DemoBadge show={l.contacts.is_demo} />
                      </div>
                      <div className="text-muted-foreground">
                        {[contactRelation.label(l.relation), l.contacts.role_title].filter(Boolean).join(" · ")}
                      </div>
                      <div className="mt-1 text-xs">{contactPermission.label(l.contacts.contact_permission)}</div>
                      {l.contacts.introduced_by && <div className="text-xs text-muted-foreground">Intro: {l.contacts.introduced_by}</div>}
                      {(l.contacts.phone || l.contacts.email) && (
                        <div className="mt-1 text-xs">{[l.contacts.phone, l.contacts.email].filter(Boolean).join(" · ")}</div>
                      )}
                      <div className="mt-1"><VerificationBadge status={l.contacts.verification_status} /></div>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin contactos vinculados.</p>
            )}
            {ctx.canEdit && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">+ Contacto</summary>
                <ActionForm action={addContact.bind(null, slug)} resetOnSuccess className="mt-3">
                  <input type="hidden" name="link_kind" value={kind} />
                  <input type="hidden" name="link_id" value={id} />
                  <TextField name="full_name" label="Nombre" />
                  <SelectField name="relation" label="Relación" defaultValue="otro" options={contactRelation.values.map((v) => ({ value: v, label: contactRelation.label(v) }))} />
                  <TextField name="role_title" label="Cargo" />
                  <SelectField name="contact_permission" label="¿Se puede contactar?" defaultValue="sin_definir" options={contactPermission.values.map((v) => ({ value: v, label: contactPermission.label(v) }))} />
                  <TextField name="introduced_by" label="Quién puede presentarnos" />
                  <TextField name="phone" label="Teléfono" hint="Solo si lo aportó legítimamente; requiere fuente." />
                  <TextField name="email" label="Email" type="email" />
                  <SelectField name="verification_status" label="Verificación" defaultValue="hipotesis" options={verificationStatus.values.map((v) => ({ value: v, label: verificationStatus.label(v) }))} />
                  <SourcePicker sources={sourceOptions} />
                  <SubmitButton>Guardar contacto</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Section>

          <Section title="Historial">
            {history?.length ? (
              <ol className="space-y-2 text-xs">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 pl-3">
                    <div className="text-muted-foreground">
                      {formatDate(h.created_at, true)} · {h.actor_id ? actorName.get(h.actor_id) ?? "usuario" : "sistema"}
                    </div>
                    <div>
                      {h.action === "insert"
                        ? "Creado"
                        : h.action === "delete"
                          ? "Eliminado"
                          : `Cambió ${Object.keys((h.changes as Record<string, unknown>) ?? {})
                              .map((k) => fieldLabels[k] ?? k)
                              .join(", ")}`}
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

function Item({ label, value, link = false }: { label: string; value: string | null | undefined; link?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {value ? (
          link ? (
            <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{value}</a>
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
