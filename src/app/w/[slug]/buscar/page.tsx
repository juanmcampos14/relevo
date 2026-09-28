import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { companyName, entityHref } from "@/server/entities";
import { EmptyState, PageHeader, Pill } from "@/components/app/bits";

export const metadata: Metadata = { title: "Buscar" };

export default async function SearchPage({ params, searchParams }: PageProps<"/w/[slug]/buscar">) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  await getWorkspaceContext(slug);
  const supabase = await createClient();
  // Escapar comodines de LIKE y separadores del filtro `or` de PostgREST.
  const term = `%${q.replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, " ")}%`;

  const results: { href: string; label: string; kind: string }[] = [];
  if (q.length >= 2) {
    const [c, e, a, ct] = await Promise.all([
      supabase.from("companies").select("id, trade_name, legal_name").or(`trade_name.ilike.${term},legal_name.ilike.${term}`).limit(20),
      supabase.from("establishments").select("id, name").or(`name.ilike.${term},address_text.ilike.${term}`).limit(20),
      supabase.from("assets").select("id, title").or(`title.ilike.${term},address_text.ilike.${term}`).limit(20),
      supabase.from("contacts").select("id, full_name, contact_links(company_id, establishment_id, asset_id)").ilike("full_name", term).limit(20),
    ]);
    c.data?.forEach((x) => results.push({ href: entityHref(slug, "company", x.id), label: companyName(x), kind: "Empresa" }));
    e.data?.forEach((x) => results.push({ href: entityHref(slug, "establishment", x.id), label: x.name, kind: "Establecimiento" }));
    a.data?.forEach((x) => results.push({ href: entityHref(slug, "asset", x.id), label: x.title, kind: "Activo" }));
    ct.data?.forEach((x) => {
      const l = x.contact_links[0];
      const href = l?.company_id
        ? entityHref(slug, "company", l.company_id)
        : l?.establishment_id
          ? entityHref(slug, "establishment", l.establishment_id)
          : l?.asset_id
            ? entityHref(slug, "asset", l.asset_id)
            : null;
      if (href) results.push({ href, label: x.full_name, kind: "Contacto" });
    });
  }

  return (
    <>
      <PageHeader title="Buscar" subtitle={q ? `Resultados para “${q}”` : "Escribí al menos 2 letras en el buscador."} />
      {q.length >= 2 &&
        (results.length ? (
          <ul className="divide-y rounded-lg border">
            {results.map((r, i) => (
              <li key={i}>
                <Link href={r.href} className="flex items-center justify-between gap-2 p-3 hover:bg-muted/50">
                  <span>{r.label}</span>
                  <Pill>{r.kind}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Sin resultados" />
        ))}
    </>
  );
}
