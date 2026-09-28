import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { companyName } from "@/server/entities";

export type RefLabel = { label: string; href: string | null };

/** Nombre y enlace de cada referencia citada (solo lo que el usuario puede ver por RLS). */
export async function labelRefs(db: SupabaseClient<Database>, slug: string, refs: string[]) {
  const byType = new Map<string, string[]>();
  for (const r of new Set(refs)) {
    const [t, id] = r.split(":");
    byType.set(t, [...(byType.get(t) ?? []), id]);
  }
  const out = new Map<string, RefLabel>();
  const base = `/w/${slug}`;
  const ids = (t: string) => byType.get(t) ?? [];
  const jobs: Promise<void>[] = [];
  const add = <T extends { id: string }>(t: string, q: PromiseLike<{ data: T[] | null }>, label: (x: T) => string, href: (x: T) => string | null) =>
    jobs.push(Promise.resolve(q).then(({ data }) => data?.forEach((x) => out.set(`${t}:${x.id}`, { label: label(x), href: href(x) }))));

  if (ids("company").length) add("company", db.from("companies").select("id, trade_name, legal_name").in("id", ids("company")), companyName, (x) => `${base}/e/company/${x.id}`);
  if (ids("establishment").length) add("establishment", db.from("establishments").select("id, name").in("id", ids("establishment")), (x) => x.name, (x) => `${base}/e/establishment/${x.id}`);
  if (ids("asset").length) add("asset", db.from("assets").select("id, title").in("id", ids("asset")), (x) => x.title, (x) => `${base}/e/asset/${x.id}`);
  if (ids("finding").length) add("finding", db.from("findings").select("id, statement").in("id", ids("finding")), (x) => `hallazgo: ${x.statement.slice(0, 60)}${x.statement.length > 60 ? "…" : ""}`, (x) => `${base}/oportunidades?h=${x.id}#h-${x.id}`);
  if (ids("opportunity").length) add("opportunity", db.from("opportunities").select("id, title").in("id", ids("opportunity")), (x) => x.title, (x) => `${base}/oportunidades/o/${x.id}`);
  if (ids("visit").length) add("visit", db.from("visits").select("id, visited_at").in("id", ids("visit")), (x) => `visita del ${new Date(x.visited_at).toLocaleDateString("es-AR")}`, (x) => `${base}/agenda/visita/${x.id}`);
  if (ids("decision").length) add("decision", db.from("decisions").select("id, question").in("id", ids("decision")), (x) => `decisión: ${x.question.slice(0, 50)}`, () => `${base}/oportunidades/decisiones`);
  if (ids("source").length) add("source", db.from("sources").select("id, title, url").in("id", ids("source")), (x) => x.title, (x) => x.url ?? `${base}/explorar/fuentes`);
  if (ids("campaign").length) add("campaign", db.from("campaigns").select("id, name").in("id", ids("campaign")), (x) => x.name, (x) => `${base}/explorar/c/${x.id}`);
  if (ids("contact").length) add("contact", db.from("contacts").select("id, full_name").in("id", ids("contact")), (x) => x.full_name, () => null);
  if (ids("task").length) add("task", db.from("tasks").select("id, title").in("id", ids("task")), (x) => `tarea: ${x.title}`, () => null);
  if (ids("news").length) add("news", db.from("news_articles").select("id, title, url").in("id", ids("news")), (x) => x.title, (x) => x.url);
  await Promise.all(jobs);
  return out;
}
