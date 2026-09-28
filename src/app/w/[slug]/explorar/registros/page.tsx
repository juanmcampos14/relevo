import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { addressStatus, assetKind, companyKind } from "@/domain/catalogs";
import { companyName, entityHref } from "@/server/entities";
import { EmptyState, PageHeader, Pill, StatusBadges } from "@/components/app/bits";

export const metadata: Metadata = { title: "Registros" };

const TABS = [
  { key: "establishment", label: "Establecimientos" },
  { key: "asset", label: "Activos" },
  { key: "company", label: "Empresas" },
] as const;

export default async function RegistrosPage({ params, searchParams }: PageProps<"/w/[slug]/explorar/registros">) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tipo)?.key ?? "establishment";
  await getWorkspaceContext(slug);
  const supabase = await createClient();

  let rows: { id: string; name: string; meta: string; verification: string; isDemo: boolean }[] = [];
  if (tab === "company") {
    const { data } = await supabase.from("companies").select("id, trade_name, legal_name, kind, locality, verification_status, is_demo").order("trade_name");
    rows = (data ?? []).map((c) => ({ id: c.id, name: companyName(c), meta: [companyKind.label(c.kind), c.locality].filter(Boolean).join(" · "), verification: c.verification_status, isDemo: c.is_demo }));
  } else if (tab === "establishment") {
    const { data } = await supabase.from("establishments").select("id, name, address_text, locality, address_status, verification_status, is_demo").order("name");
    rows = (data ?? []).map((e) => ({ id: e.id, name: e.name, meta: [e.address_text, e.locality, addressStatus.label(e.address_status)].filter(Boolean).join(" · "), verification: e.verification_status, isDemo: e.is_demo }));
  } else {
    const { data } = await supabase.from("assets").select("id, title, kind, operation, locality, verification_status, is_demo").order("title");
    rows = (data ?? []).map((a) => ({ id: a.id, name: a.title, meta: [assetKind.label(a.kind), a.operation !== "desconocida" && a.operation, a.locality].filter(Boolean).join(" · "), verification: a.verification_status, isDemo: a.is_demo }));
  }

  return (
    <>
      <PageHeader title="Registros" subtitle="Cada empresa, establecimiento y activo existe una sola vez; las campañas lo referencian." />
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`?tipo=${t.key}`} className={`inline-flex h-8 items-center rounded-full border px-3 text-sm ${tab === t.key ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <Link href={entityHref(slug, tab, r.id)} className="font-medium hover:underline">{r.name}</Link>
                <div className="text-sm text-muted-foreground">{r.meta}</div>
              </div>
              <div className="flex gap-2">
                <StatusBadges verification={r.verification} isDemo={r.isDemo} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Sin registros">Se crean desde una campaña con “Agregar objetivo”.</EmptyState>
      )}
      <p className="mt-4 text-xs text-muted-foreground"><Pill>Tip</Pill> Para cargar uno nuevo, entrá a una campaña: así queda vinculado a una vertical desde el inicio.</p>
    </>
  );
}
