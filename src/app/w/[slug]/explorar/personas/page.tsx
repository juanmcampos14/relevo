import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { contactKind, contactPermission } from "@/domain/catalogs";
import { companyName } from "@/server/entities";
import { EmptyState, PageHeader, Pill } from "@/components/app/bits";

export const metadata: Metadata = { title: "Personas" };

// Personas y canales de la red: los del CRM importado y los que llegan de campo, en un solo registro.
export default async function PeoplePage({ params, searchParams }: PageProps<"/w/[slug]/explorar/personas">) {
  const { slug } = await params;
  const sp = await searchParams;
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const kind = sp.tipo === "canal_institucional" ? "canal_institucional" : sp.tipo === "persona" ? "persona" : null;
  let query = supabase
    .from("contacts")
    .select("id, full_name, contact_kind, role_title, contact_permission, relationship_status, is_demo, contact_links(companies(trade_name, legal_name), establishments(name), assets(title)), evidence:evidence!evidence_workspace_id_stated_by_contact_id_fkey(count)")
    .order("full_name")
    .limit(500);
  if (q) {
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;
    query = query.or(`full_name.ilike.${like},role_title.ilike.${like},email.ilike.${like}`);
  }
  if (kind) query = query.eq("contact_kind", kind);
  const { data: people } = await query;
  const base = `/w/${slug}/explorar/personas`;

  return (
    <>
      <PageHeader title="Personas" subtitle="Quiénes son, con qué empresa están y qué nos dijeron. Las personas sin identificar están en su propia pestaña." />
      <form className="mb-3 flex gap-2">
        {kind && <input type="hidden" name="tipo" value={kind} />}
        <input name="q" defaultValue={q} placeholder="Buscar por nombre, cargo o email" className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" />
        <button className="h-10 rounded-lg border px-3 text-sm">Buscar</button>
      </form>
      <div className="mb-4 flex gap-2">
        {[{ k: null, l: "Todas" }, { k: "persona", l: "Personas" }, { k: "canal_institucional", l: "Canales institucionales" }].map((t) => (
          <Link key={t.l} href={`${base}${t.k ? `?tipo=${t.k}` : ""}`} className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${kind === t.k ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>{t.l}</Link>
        ))}
      </div>
      {people?.length ? (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {people.map((p) => {
            const orgs = p.contact_links.map((l) => (l.companies ? companyName(l.companies) : l.establishments?.name ?? l.assets?.title)).filter(Boolean);
            const said = p.evidence[0]?.count ?? 0;
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <Link href={`${base}/${p.id}`} className="font-medium hover:underline">{p.full_name}</Link>
                  <div className="text-sm text-muted-foreground">{[p.role_title, orgs.join(", ") || "sin empresa vinculada", said ? `${said} ${said === 1 ? "dato aportado" : "datos aportados"}` : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex gap-2">
                  {p.contact_kind === "canal_institucional" && <Pill>{contactKind.label(p.contact_kind)}</Pill>}
                  <Pill>{contactPermission.label(p.contact_permission)}</Pill>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={q ? "Nadie coincide con la búsqueda" : "Todavía no hay personas"}>Llegan del CRM importado o de las capturas de campo.</EmptyState>
      )}
    </>
  );
}
