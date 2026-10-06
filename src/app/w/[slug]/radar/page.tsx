import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/server/context";
import { CHANGE_LABEL, BASIS_LABEL } from "@/domain/brief/contract";
import { EmptyState, PageHeader, Pill, Section, formatDate } from "@/components/app/bits";
import { DiscrepancyButtons, TriageButtons } from "./triage";

export const metadata: Metadata = { title: "Radar" };

const money = (n: number, c: string) => `${c} ${Number(n).toLocaleString("es-AR")}`;
const ORIGIN: Record<string, string> = { brief: "Morning Brief", radar_sheet: "RADAR del Sheet", captura: "Captura", vigilancia: "Vigilancia" };
const ENTITY: Record<string, string> = { company: "empresa", contact: "persona", establishment: "establecimiento", asset: "activo", signal: "señal" };

// Radar: lo que RELEVO aprendió afuera, persistido. Activos con historial de precios (observación ≠
// conclusión: precios distintos = inconsistente, nunca una baja calculada) y señales con su origen.
export default async function RadarPage({ params }: PageProps<"/w/[slug]/radar">) {
  const { slug } = await params;
  const ctx = await getWorkspaceContext(slug);
  const supabase = await createClient();
  const base = `/w/${slug}`;
  const [{ data: assets }, { data: signals }, { data: attention }, { data: diffs }] = await Promise.all([
    supabase.from("assets").select("id, title, category, locality, operation, price_status, broker_text, owner_text, capacity_text, occupancy_declared, material_change, radar_ref, last_checked_on, asset_prices(amount, currency, operation, period, observed_on, source_url, publisher, origin, note), findings(id, dedup_key, statement)").eq("is_demo", false).order("last_checked_on", { ascending: false, nullsFirst: false }),
    supabase.from("brief_signals").select("id, headline, happened_on, source_url, publisher, origin, external_ref, change, basis, brief_id, story_id, status, brief_stories(title)").order("happened_on", { ascending: false, nullsFirst: false }).limit(80),
    // Lo que merece atención: lo que RELEVO juzgó que importa y todavía nadie confirmó.
    supabase.from("brief_signals").select("id, headline, triage_reason, suggested_action, source_url, publisher, origin, external_ref, happened_on").eq("status", "incorporada").is("triaged_by", null).order("created_at", { ascending: false }).limit(20),
    supabase.from("source_discrepancies").select("id, entity_type, entity_id, field, current_value, incoming_value, source, source_ref").eq("status", "pendiente").order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <>
      <PageHeader title="Radar" subtitle="Lo que RELEVO aprendió afuera, guardado con su fuente: activos con historial de precios y señales. Una observación no es una conclusión." />
      <div className="space-y-8">
        {(attention?.length || diffs?.length) ? (
          <Section title="Merece tu atención">
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {(attention ?? []).map((s) => (
                <li key={s.id} className="space-y-1.5 p-4">
                  <p className="font-medium">{s.headline}</p>
                  {s.triage_reason && <p className="text-xs text-muted-foreground">RELEVO: {s.triage_reason}</p>}
                  {s.suggested_action && <p className="text-xs">Qué haría: {s.suggested_action}</p>}
                  <p className="text-xs text-muted-foreground">{ORIGIN[s.origin] ?? s.origin}{s.external_ref ? ` · ${s.external_ref}` : ""}{s.source_url ? <> · <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{s.publisher || new URL(s.source_url).hostname}</a></> : null}</p>
                  {ctx.canEdit && <TriageButtons slug={slug} id={s.id} />}
                </li>
              ))}
              {(diffs ?? []).map((d) => (
                <li key={d.id} className="space-y-1.5 p-4">
                  <p className="font-medium">Encontré información diferente sobre un {ENTITY[d.entity_type] ?? d.entity_type} ({d.field.replace(/_/g, " ")})</p>
                  <p className="text-xs">Ahora: «{d.current_value ?? "—"}» · Llega de {d.source}{d.source_ref ? ` ${d.source_ref}` : ""}: «{d.incoming_value ?? "—"}»</p>
                  <p className="text-xs text-muted-foreground">Lo corrigió una persona: no se pisó. Decidí cuál queda.</p>
                  {ctx.canEdit && <DiscrepancyButtons slug={slug} id={d.id} />}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title={`Activos (${assets?.length ?? 0})`}>
          {assets?.length ? (
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {assets.map((a) => {
                const prices = [...(a.asset_prices ?? [])].sort((x, y) => (y.observed_on ?? "").localeCompare(x.observed_on ?? ""));
                return (
                  <li key={a.id} className="space-y-1.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`${base}/e/asset/${a.id}`} className="font-medium hover:underline">{a.title}</Link>
                      {a.radar_ref && <span className="font-mono text-xs text-muted-foreground">{a.radar_ref}</span>}
                      {a.price_status === "inconsistente" && <Pill className="border-amber-500/50 text-amber-700 dark:text-amber-300">PRECIO INCONSISTENTE — verificar</Pill>}
                      {a.material_change?.startsWith("REVISAR") && <Pill className="border-destructive/50 text-destructive">revisar datos</Pill>}
                    </div>
                    <p className="text-xs text-muted-foreground">{[a.category, a.locality, a.operation, a.capacity_text, a.occupancy_declared && `ocupación: ${a.occupancy_declared}`, a.broker_text && `broker: ${a.broker_text}`].filter(Boolean).join(" · ")}</p>
                    {prices.length > 0 && (
                      <ul className="space-y-0.5 text-xs">
                        {prices.map((p, i) => (
                          <li key={i}>
                            <span className="tabular-nums font-medium">{money(p.amount, p.currency)}{p.period ? `/${p.period}` : ""}</span>
                            <span className="text-muted-foreground"> · {p.observed_on ?? "fecha s/d"} · {p.source_url ? <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{p.publisher || new URL(p.source_url).hostname}</a> : "fuente s/d"} · {ORIGIN[p.origin] ?? p.origin}{p.note ? ` · ${p.note}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.material_change?.startsWith("REVISAR") && <p className="text-xs text-destructive">{a.material_change}</p>}
                    {(a.findings ?? []).map((f) => <Link key={f.id} href={`${base}/hallazgos/${f.id}`} className="block text-xs text-primary hover:underline">Hipótesis {f.dedup_key?.slice(4)}: {f.statement.slice(0, 90)}</Link>)}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState title="Todavía no hay activos en el Radar" />}
        </Section>
        <Section title="Señales recientes">
          {signals?.length ? (
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {signals.map((s) => (
                <li key={s.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill>{CHANGE_LABEL[s.change as keyof typeof CHANGE_LABEL] ?? s.change}</Pill>
                    <Pill>{BASIS_LABEL[s.basis as keyof typeof BASIS_LABEL] ?? s.basis}</Pill>
                    <span className="text-xs text-muted-foreground">{ORIGIN[s.origin] ?? s.origin}{s.external_ref ? ` · ${s.external_ref}` : ""} · {s.happened_on ? formatDate(s.happened_on) : "s/f"}</span>
                  </div>
                  <p>{s.headline}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.source_url ? <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{s.publisher || new URL(s.source_url).hostname}</a> : "sin enlace"}
                    {s.brief_stories?.title ? ` · Historia: ${s.brief_stories.title}` : ""}
                    {s.brief_id ? <> · <Link href={`${base}/brief/${s.brief_id}`} className="hover:underline">brief</Link></> : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Sin señales" />}
        </Section>
      </div>
    </>
  );
}
