import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FindingRow } from "@/components/oportunidades/finding-card";
import { companyName } from "./entities";

export const findingSelect = `id, kind, statement, evidence, analysis, origin, verification_status, review_status, review_note,
  reviewed_by, reviewed_at, created_at, created_by, visit_id, campaign_id,
  sources(id, title, url, is_demo, reference),
  companies(id, trade_name, legal_name), establishments(id, name), assets(id, title),
  finding_evidence(stance, evidence(id, statement, quote, verification_status, capture_id))`;

type Raw = Omit<FindingRow, "entity"> & {
  companies: { id: string; trade_name: string | null; legal_name: string | null } | null;
  establishments: { id: string; name: string } | null;
  assets: { id: string; title: string } | null;
};

export function toFindingRow(r: Raw): FindingRow {
  const entity = r.companies
    ? { kind: "company" as const, id: r.companies.id, name: companyName(r.companies) }
    : r.establishments
      ? { kind: "establishment" as const, id: r.establishments.id, name: r.establishments.name }
      : r.assets
        ? { kind: "asset" as const, id: r.assets.id, name: r.assets.title }
        : null;
  return { ...r, entity };
}

/** Nombres visibles de usuarios (solo los que comparten workspace, por RLS). */
export async function profileNames(supabase: SupabaseClient<Database>, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("user_id, display_name, email").in("user_id", unique);
  return new Map((data ?? []).map((p) => [p.user_id, p.display_name || p.email]));
}

/** Opciones "tipo:id" para vincular un hallazgo a un registro. */
export async function entityOptions(supabase: SupabaseClient<Database>) {
  const [c, e, a] = await Promise.all([
    supabase.from("companies").select("id, trade_name, legal_name").order("trade_name"),
    supabase.from("establishments").select("id, name").order("name"),
    supabase.from("assets").select("id, title").order("title"),
  ]);
  return [
    ...(e.data ?? []).map((x) => ({ value: `establishment:${x.id}`, label: `Establecimiento · ${x.name}` })),
    ...(a.data ?? []).map((x) => ({ value: `asset:${x.id}`, label: `Activo · ${x.title}` })),
    ...(c.data ?? []).map((x) => ({ value: `company:${x.id}`, label: `Empresa · ${companyName(x)}` })),
  ];
}

export async function sourceOptions(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.from("sources").select("id, title, url").order("captured_at", { ascending: false }).limit(300);
  return (data ?? []).map((s) => ({ value: s.id, label: s.url ? `${s.title} — ${new URL(s.url).hostname}` : s.title }));
}
