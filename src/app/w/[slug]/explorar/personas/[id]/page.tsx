import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { contactKind, contactPermission, taskStatus } from "@/domain/catalogs";
import { evidenceProvenance } from "@/domain/provenance";
import { companyName, entityHref } from "@/server/entities";
import { PageHeader, Pill, Section, VerificationBadge, formatDate } from "@/components/app/bits";
import { ProvenanceTag } from "@/components/app/provenance-tag";

export const metadata: Metadata = { title: "Persona" };

// Ficha de una persona: con quién está, qué dijo (con su fuente), qué hacemos con ella y de dónde salió.
export default async function PersonPage({ params }: PageProps<"/w/[slug]/explorar/personas/[id]">) {
  const { slug, id } = await params;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const { data: c } = await supabase
    .from("contacts")
    .select("id, full_name, contact_kind, role_title, email, phone, profile_url, preferred_channel, relationship_status, contact_permission, introduced_by, notes, verification_status, created_at, sources(title, url), contact_links(relation, companies(id, trade_name, legal_name), establishments(id, name), assets(id, title))")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const [{ data: said }, { data: tasks }, { data: refs }, { data: fromCapture }, { data: wasUnresolved }] = await Promise.all([
    supabase.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, observed_at, capture_id, capture_media_id, media_start_ms, companies(id, trade_name, legal_name), finding_evidence(stance, findings(id, statement))").eq("stated_by_contact_id", id).order("observed_at", { ascending: false, nullsFirst: false }),
    supabase.from("tasks").select("id, title, status, due_on, finding_id").eq("contact_id", id).order("due_on", { nullsFirst: false }),
    supabase.from("external_refs").select("external_id, sheet, row_number, first_imported_at, last_batch_id").eq("entity_id", id),
    supabase.from("proposals").select("capture_id, decided_at").eq("result_id", id).eq("kind", "person").not("capture_id", "is", null),
    supabase.from("unresolved_entities").select("label, capture_id, resolved_at").eq("resolved_contact_id", id),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        back={<Link href={`${base}/explorar/personas`} className="hover:underline">← Personas</Link>}
        title={c.full_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.role_title && <span>{c.role_title}</span>}
            {c.contact_kind === "canal_institucional" && <Pill>{contactKind.label(c.contact_kind)}</Pill>}
            <Pill>{contactPermission.label(c.contact_permission)}</Pill>
            <VerificationBadge status={c.verification_status} />
          </span>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <Section title={`Qué nos dijo (${said?.length ?? 0})`}>
            {said?.length ? (
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {said.map((e) => (
                  <li key={e.id} className="space-y-1.5 p-4">
                    <p className="text-sm">{e.statement}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <ProvenanceTag {...evidenceProvenance({ ...e, speaker: c.full_name })} />
                      {e.companies && <Link href={entityHref(slug, "company", e.companies.id)} className="text-primary hover:underline">{companyName(e.companies)}</Link>}
                      {e.capture_id && <Link href={`${base}/capturas/${e.capture_id}`} className="text-primary hover:underline">captura original</Link>}
                      <span>{formatDate(e.observed_at)}</span>
                    </div>
                    {e.finding_evidence.map((fe) => fe.findings && (
                      <p key={fe.findings.id} className={`text-xs ${fe.stance === "contradicts" ? "text-destructive" : "text-muted-foreground"}`}>
                        {fe.stance === "contradicts" ? "En contra de" : fe.stance === "supports" ? "A favor de" : "Contexto para"}{" "}
                        <Link href={`${base}/hallazgos/${fe.findings.id}`} className="underline">«{fe.findings.statement}»</Link>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Todavía no aportó evidencia registrada.</p>
            )}
          </Section>
          <Section title="Qué hacemos con esta persona">
            {tasks?.length ? (
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
                {tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span>{t.finding_id ? <Link href={`${base}/hallazgos/${t.finding_id}`} className="hover:underline">{t.title}</Link> : t.title}</span>
                    <span className="text-xs text-muted-foreground">{taskStatus.label(t.status)}{t.due_on ? ` · ${formatDate(t.due_on)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin acciones con esta persona.</p>
            )}
          </Section>
        </div>
        <aside className="space-y-8">
          <Section title="Con quién está">
            {c.contact_links.length ? (
              <ul className="space-y-1 text-sm">
                {c.contact_links.map((l, i) => (
                  <li key={i}>
                    {l.companies ? <Link href={entityHref(slug, "company", l.companies.id)} className="text-primary hover:underline">{companyName(l.companies)}</Link>
                      : l.establishments ? <Link href={entityHref(slug, "establishment", l.establishments.id)} className="text-primary hover:underline">{l.establishments.name}</Link>
                      : l.assets ? <Link href={entityHref(slug, "asset", l.assets.id)} className="text-primary hover:underline">{l.assets.title}</Link> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin empresa vinculada.</p>
            )}
          </Section>
          <Section title="Contacto">
            <dl className="space-y-1 text-sm">
              {c.email && <div><dt className="inline text-muted-foreground">Email: </dt><dd className="inline"><a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a></dd></div>}
              {c.phone && <div><dt className="inline text-muted-foreground">Teléfono: </dt><dd className="inline"><a href={`tel:${c.phone}`} className="text-primary hover:underline">{c.phone}</a></dd></div>}
              {c.profile_url && <div><a href={c.profile_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Perfil</a></div>}
              {c.relationship_status && <div><dt className="inline text-muted-foreground">Relación: </dt><dd className="inline">{c.relationship_status}</dd></div>}
              {c.introduced_by && <div><dt className="inline text-muted-foreground">Intro: </dt><dd className="inline">{c.introduced_by}</dd></div>}
              {!c.email && !c.phone && !c.profile_url && <p className="text-muted-foreground">Sin canales registrados.</p>}
            </dl>
          </Section>
          <Section title="De dónde salió">
            <ul className="space-y-2 text-sm">
              {(refs ?? []).map((r) => (
                <li key={r.external_id}>
                  CRM de Sheets · {r.external_id}{r.sheet ? ` · ${r.sheet}${r.row_number ? `, fila ${r.row_number}` : ""}` : ""}
                  <span className="block text-xs text-muted-foreground">Importado {formatDate(r.first_imported_at, true)}</span>
                  {r.last_batch_id && <Link href={`${base}/integraciones/importar/${r.last_batch_id}`} className="text-xs text-primary hover:underline">Ver el lote</Link>}
                </li>
              ))}
              {(fromCapture ?? []).map((p) => (
                <li key={p.capture_id}>Captura de campo · <Link href={`${base}/capturas/${p.capture_id}`} className="text-primary hover:underline">ver</Link><span className="block text-xs text-muted-foreground">Aceptada {formatDate(p.decided_at, true)}</span></li>
              ))}
              {(wasUnresolved ?? []).map((u) => (
                <li key={u.label}>Antes sin identificar: «{u.label}»<span className="block text-xs text-muted-foreground">Resuelta {formatDate(u.resolved_at, true)}{u.capture_id ? " · " : ""}{u.capture_id && <Link href={`${base}/capturas/${u.capture_id}`} className="text-primary hover:underline">primera captura</Link>}</span></li>
              ))}
              {c.sources && <li>Fuente: {c.sources.url ? <a href={c.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{c.sources.title}</a> : c.sources.title}</li>}
              {!refs?.length && !fromCapture?.length && !wasUnresolved?.length && !c.sources && <li className="text-muted-foreground">Cargada en RELEVO · {formatDate(c.created_at)}</li>}
            </ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}
