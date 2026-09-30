import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { resolveEntityAction } from "../capturas/actions";

export const metadata: Metadata = { title: "Sin identificar" };

// Organizaciones y personas que ya aportan evidencia pero todavía no sabemos quiénes son.
// Resolverlas pasa su evidencia e historia a la empresa o persona real, sin perder de dónde salió.
export default async function UnresolvedPage({ params }: PageProps<"/w/[slug]/sin-identificar">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const [{ data: open }, { data: done }, { data: companies }, { data: contacts }] = await Promise.all([
    supabase.from("unresolved_entities").select("id, kind, label, description, capture_id, created_at, parent:unresolved_entities!unresolved_entities_workspace_id_parent_id_fkey(label)").is("resolved_at", null).order("created_at", { ascending: false }),
    supabase.from("unresolved_entities").select("id, kind, label, resolved_at, companies(trade_name), contacts(full_name)").not("resolved_at", "is", null).order("resolved_at", { ascending: false }).limit(20),
    supabase.from("companies").select("id, trade_name, legal_name, locality").order("trade_name").limit(1000),
    supabase.from("contacts").select("id, full_name, role_title").eq("contact_kind", "persona").order("full_name").limit(1000),
  ]);
  const ids = (open ?? []).map((u) => u.id);
  const { data: ev } = ids.length
    ? await supabase.from("evidence").select("statement, about_unresolved_id, stated_by_unresolved_id").or(`about_unresolved_id.in.(${ids.join(",")}),stated_by_unresolved_id.in.(${ids.join(",")})`)
    : { data: [] };
  const evidenceOf = (id: string) => (ev ?? []).filter((e) => e.about_unresolved_id === id || e.stated_by_unresolved_id === id);

  return (
    <div className="space-y-8">
      <PageHeader title="Sin identificar" subtitle="Aportan evidencia, pero todavía no sabemos quiénes son. Cuando lo sepas, resolvelas: su historia pasa a la empresa o persona real." />
      <Section title={`Por identificar (${open?.length ?? 0})`}>
        {open?.length ? (
          <ul className="space-y-3">
            {open.map((u) => {
              const facts = evidenceOf(u.id);
              return (
                <li key={u.id} className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{u.label}</span>
                    <Pill>{u.kind === "organization" ? "Organización" : "Persona"}</Pill>
                    {parentLabel(u.parent) && <span className="text-xs text-muted-foreground">de {parentLabel(u.parent)}</span>}
                    <span className="text-xs text-muted-foreground">{formatDate(u.created_at)}</span>
                    {u.capture_id && <Link href={`${base}/capturas/${u.capture_id}`} className="text-sm text-primary hover:underline">Ver captura</Link>}
                  </div>
                  {facts.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {facts.slice(0, 4).map((e, i) => <li key={i}>{e.statement}</li>)}
                      {facts.length > 4 && <li className="list-none text-xs">y {facts.length - 4} más</li>}
                    </ul>
                  )}
                  {ctx.canEdit && (
                    <ActionForm action={resolveEntityAction.bind(null, slug, u.id)} className="flex flex-wrap items-end gap-2">
                      <label className="min-w-0 flex-1 space-y-1 text-sm">
                        <span className="font-medium">{u.kind === "organization" ? "Es la empresa" : "Es la persona"}</span>
                        <select name="target" defaultValue="" className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
                          <option value="" disabled>Elegí…</option>
                          {u.kind === "organization"
                            ? (companies ?? []).map((c) => <option key={c.id} value={`company:${c.id}`}>{c.trade_name ?? c.legal_name}{c.locality ? ` · ${c.locality}` : ""}</option>)
                            : (contacts ?? []).map((c) => <option key={c.id} value={`contact:${c.id}`}>{c.full_name}{c.role_title ? ` · ${c.role_title}` : ""}</option>)}
                        </select>
                      </label>
                      <SubmitButton>Resolver</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nada sin identificar.</p>
        )}
      </Section>
      {done?.length ? (
        <Section title="Resueltas">
          <ul className="space-y-1 text-sm text-muted-foreground">
            {done.map((u) => (
              <li key={u.id}>{u.label} → <span className="text-foreground">{u.companies?.trade_name ?? u.contacts?.full_name ?? "—"}</span> · {formatDate(u.resolved_at!)}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

const parentLabel = (p: { label: string } | { label: string }[] | null) => (Array.isArray(p) ? p[0]?.label : p?.label) ?? null;
