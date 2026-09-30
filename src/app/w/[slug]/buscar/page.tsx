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
    const [c, e, a, ct, f, ev, u] = await Promise.all([
      supabase.from("companies").select("id, trade_name, legal_name").or(`trade_name.ilike.${term},legal_name.ilike.${term}`).limit(20),
      supabase.from("establishments").select("id, name").or(`name.ilike.${term},address_text.ilike.${term}`).limit(20),
      supabase.from("assets").select("id, title").or(`title.ilike.${term},address_text.ilike.${term}`).limit(20),
      supabase.from("contacts").select("id, full_name, role_title").or(`full_name.ilike.${term},role_title.ilike.${term},email.ilike.${term}`).limit(20),
      supabase.from("findings").select("id, statement, maturity").ilike("statement", term).neq("review_status", "rechazado").limit(15),
      supabase.from("evidence").select("id, statement, capture_id, company_id, asset_id").ilike("statement", term).limit(15),
      supabase.from("unresolved_entities").select("id, label").ilike("label", term).is("resolved_at", null).limit(10),
    ]);
    c.data?.forEach((x) => results.push({ href: entityHref(slug, "company", x.id), label: companyName(x), kind: "Empresa" }));
    e.data?.forEach((x) => results.push({ href: entityHref(slug, "establishment", x.id), label: x.name, kind: "Establecimiento" }));
    a.data?.forEach((x) => results.push({ href: entityHref(slug, "asset", x.id), label: x.title, kind: "Activo" }));
    ct.data?.forEach((x) => results.push({ href: `/w/${slug}/explorar/personas/${x.id}`, label: x.role_title ? `${x.full_name} · ${x.role_title}` : x.full_name, kind: "Persona" }));
    u.data?.forEach((x) => results.push({ href: `/w/${slug}/explorar/sin-identificar`, label: x.label, kind: "Sin identificar" }));
    f.data?.forEach((x) => results.push({ href: `/w/${slug}/hallazgos/${x.id}`, label: x.statement, kind: x.maturity === "finding" ? "Finding" : x.maturity === "idea" ? "Idea" : "Hipótesis" }));
    ev.data?.forEach((x) => {
      const href = x.capture_id ? `/w/${slug}/capturas/${x.capture_id}` : x.company_id ? entityHref(slug, "company", x.company_id) : x.asset_id ? entityHref(slug, "asset", x.asset_id) : `/w/${slug}/explorar/evidencia?q=${encodeURIComponent(q)}`;
      results.push({ href, label: x.statement, kind: "Evidencia" });
    });
  }

  return (
    <>
      <PageHeader title="Buscar" subtitle={q ? `Resultados para “${q}”` : "Escribí al menos 2 letras en el buscador."} />
      {q.length >= 2 &&
        (results.length ? (
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
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
