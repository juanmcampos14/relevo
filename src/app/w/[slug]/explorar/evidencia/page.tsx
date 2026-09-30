import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { evidenceType } from "@/domain/catalogs";
import { PROVENANCE, evidenceProvenance, type ProvenanceTag as Tag } from "@/domain/provenance";
import { companyName, entityHref } from "@/server/entities";
import { EmptyState, PageHeader, VerificationBadge, formatDate } from "@/components/app/bits";
import { ProvenanceTag } from "@/components/app/provenance-tag";

export const metadata: Metadata = { title: "Evidencia" };

const ORIGINS: Record<Exclude<Tag, "calculo" | "hipotesis" | "desconocido">, string[]> = {
  campo: ["field", "interview", "conversation"],
  relevo: ["crm_import", "manual", "email"],
  web: ["website", "public_registry", "press", "aog", "ai_research"],
};

// Todo lo que sabemos, con su procedencia: qué es, sobre quién, quién lo dijo y de dónde salió.
export default async function EvidencePage({ params, searchParams }: PageProps<"/w/[slug]/explorar/evidencia">) {
  const { slug } = await params;
  const sp = await searchParams;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const tag = (Object.keys(ORIGINS) as (keyof typeof ORIGINS)[]).find((k) => k === sp.origen) ?? null;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  let query = supabase
    .from("evidence")
    .select("id, statement, evidence_type, origin_kind, verification_status, declared_by, observed_at, created_at, capture_id, companies(id, trade_name, legal_name), assets(id, title), sources(title, url), stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(id, full_name), about_u:unresolved_entities!evidence_about_unresolved_fk(label), said_u:unresolved_entities!evidence_stated_by_unresolved_fk(label), finding_evidence(stance, findings(id, statement))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (tag) query = query.in("origin_kind", ORIGINS[tag]);
  if (q) query = query.ilike("statement", `%${q.replace(/[%_]/g, " ")}%`);
  const { data: rows } = await query;
  const href = (o: string | null) => `?${[o && `origen=${o}`, q && `q=${encodeURIComponent(q)}`].filter(Boolean).join("&")}`;

  return (
    <>
      <PageHeader title="Evidencia" subtitle="Cada dato con su procedencia: campo (observado o declarado), RELEVO (CRM, carga manual) o fuente externa." />
      <form className="mb-3 flex gap-2">
        {tag && <input type="hidden" name="origen" value={tag} />}
        <input name="q" defaultValue={q} placeholder="Buscar en la evidencia (p. ej. reintegro, vianda, 18.000)" className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" />
        <button className="h-10 rounded-lg border px-3 text-sm">Buscar</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">
        {[null, ...Object.keys(ORIGINS)].map((o) => (
          <Link key={o ?? "todas"} href={href(o)} className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${tag === o ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>
            {o ? PROVENANCE[o as Tag].label : "Toda"}
          </Link>
        ))}
      </div>
      {rows?.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {rows.map((e) => (
            <li key={e.id} className="space-y-1.5 p-4">
              <p className="text-sm">{e.statement}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <ProvenanceTag {...evidenceProvenance({ origin_kind: e.origin_kind, verification_status: e.verification_status, declared_by: e.declared_by, speaker: e.stated_by?.full_name ?? e.said_u?.label ?? null })} />
                <VerificationBadge status={e.verification_status} />
                <span>{evidenceType.label(e.evidence_type)}</span>
                {e.companies ? <Link href={entityHref(slug, "company", e.companies.id)} className="text-primary hover:underline">{companyName(e.companies)}</Link>
                  : e.about_u ? <span>{e.about_u.label} (sin identificar)</span> : null}
                {e.assets && <Link href={entityHref(slug, "asset", e.assets.id)} className="text-primary hover:underline">{e.assets.title}</Link>}
                {e.stated_by && <Link href={`${base}/explorar/personas/${e.stated_by.id}`} className="text-primary hover:underline">{e.stated_by.full_name}</Link>}
                {e.capture_id && <Link href={`${base}/capturas/${e.capture_id}`} className="text-primary hover:underline">captura original</Link>}
                {e.sources?.url && <a href={e.sources.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{e.sources.title}</a>}
                <span>{formatDate(e.observed_at ?? e.created_at)}</span>
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
        <EmptyState title="Sin evidencia para ese filtro" />
      )}
    </>
  );
}
