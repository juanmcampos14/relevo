import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Lo que RELEVO ya sabe, en forma compacta, para cruzar las noticias con la memoria.
// El cliente es de servicio (cron): TODAS las consultas filtran por workspace_id.

export type BriefMemory = {
  companies: { id: string; name: string; sector: string | null }[];
  findings: { id: string; statement: string; maturity: string }[];
  campaigns: { id: string; name: string; kind: string }[];
  assets: { id: string; title: string; kind: string; locality: string | null; radar_ref: string | null; price_status: string | null; lastPrice: { amount: number; currency: string; observed_on: string | null; source_url: string | null } | null }[];
  stories: { id: string; title: string; summary: string | null; status: string; watch_reason: string | null; first_seen_on: string; last_seen_on: string }[];
  recentSignals: { id: string; headline: string; summary: string | null; source_url: string | null; story_id: string | null; happened_on: string | null; change: string; company_ids: string[]; asset_ids: string[]; origin: string }[];
  /** Historial largo para reconocer el mismo hecho (no va al prompt): señales de 180 días. */
  historySignals: { id: string; headline: string; summary: string | null; story_id: string | null; happened_on: string | null; company_ids: string[]; asset_ids: string[] }[];
  missionObjective: string | null;
};

export async function loadBriefMemory(db: SupabaseClient<Database>, workspaceId: string): Promise<BriefMemory> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  // Las historias abiertas se siguen aunque lleven semanas sin novedades: el conocimiento de RELEVO pesa
  // más que la ventana temporal.
  const storiesSince = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const historySince = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const [companies, findings, campaigns, assets, stories, signals, history] = await Promise.all([
    db.from("companies").select("id, trade_name, legal_name, sector").eq("workspace_id", workspaceId).eq("is_demo", false).limit(600),
    db.from("findings").select("id, statement, maturity, case_status, review_status").eq("workspace_id", workspaceId).neq("review_status", "rechazado").order("updated_at", { ascending: false }).limit(80),
    db.from("campaigns").select("id, name, kind, status, objective").eq("workspace_id", workspaceId).eq("status", "activa"),
    db.from("assets").select("id, title, kind, locality, radar_ref, price_status, asset_prices(amount, currency, observed_on, source_url)").eq("workspace_id", workspaceId).eq("is_demo", false).limit(150),
    db.from("brief_stories").select("id, title, summary, status, watch_reason, first_seen_on, last_seen_on").eq("workspace_id", workspaceId).neq("status", "cerrada").gte("last_seen_on", storiesSince).order("last_seen_on", { ascending: false }).limit(100),
    db.from("brief_signals").select("id, headline, summary, source_url, story_id, happened_on, change, company_ids, asset_ids, origin").eq("workspace_id", workspaceId).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
    db.from("brief_signals").select("id, headline, summary, story_id, happened_on, company_ids, asset_ids").eq("workspace_id", workspaceId).lt("created_at", since).gte("created_at", historySince).order("created_at", { ascending: false }).limit(1000),
  ]);
  const mission = (campaigns.data ?? []).find((c) => c.kind === "mision");
  return {
    companies: (companies.data ?? []).map((c) => ({ id: c.id, name: c.trade_name ?? c.legal_name ?? "", sector: c.sector })).filter((c) => c.name),
    findings: (findings.data ?? []).filter((f) => !f.case_status || f.case_status === "activo" || f.case_status === "pausado").map((f) => ({ id: f.id, statement: f.statement, maturity: f.maturity })),
    campaigns: (campaigns.data ?? []).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    assets: (assets.data ?? []).map(({ asset_prices, ...a }) => {
      const last = [...(asset_prices ?? [])].sort((x, y) => (y.observed_on ?? "").localeCompare(x.observed_on ?? ""))[0];
      return { ...a, lastPrice: last ? { amount: Number(last.amount), currency: last.currency, observed_on: last.observed_on, source_url: last.source_url } : null };
    }),
    stories: stories.data ?? [],
    recentSignals: signals.data ?? [],
    historySignals: history.data ?? [],
    missionObjective: mission?.objective ?? null,
  };
}

/** Memoria en texto para el modelo (ids exactos: el modelo solo puede citar lo que está acá). */
export function memoryDigest(m: BriefMemory): string {
  const L: string[] = [];
  L.push(`MISIÓN: ${m.missionObjective ?? "Descubrir, validar y desarrollar oportunidades de inversión y negocio a partir de necesidades reales, evidencia de campo e inteligencia de mercado."}`);
  L.push("", "PROYECTOS Y MISIÓN (campaign · id · nombre):", ...m.campaigns.map((c) => `campaign · ${c.id} · ${c.name} (${c.kind})`));
  L.push("", "HISTORIAS QUE VENIMOS SIGUIENDO (id · estado · desde → última vez · título · estado actual):");
  L.push(...(m.stories.length ? m.stories.map((s) => `${s.id} · ${s.status}${s.watch_reason ? ` (${s.watch_reason})` : ""} · ${s.first_seen_on} → ${s.last_seen_on} · ${s.title} · ${s.summary ?? ""}`) : ["(ninguna todavía)"]));
  L.push("", "SEÑALES YA REPORTADAS EN LOS ÚLTIMOS 14 DÍAS (no las repitas como nuevas):");
  L.push(...(m.recentSignals.length ? m.recentSignals.map((s) => `- ${s.happened_on ?? "s/f"} · ${s.headline}${s.source_url ? ` · ${s.source_url}` : ""}${s.story_id ? ` · historia ${s.story_id}` : ""}${s.origin === "radar_sheet" ? " · (Radar)" : ""}`) : ["(ninguna todavía)"]));
  L.push("", "HIPÓTESIS ABIERTAS (finding · id · madurez · enunciado):", ...m.findings.map((f) => `finding · ${f.id} · ${f.maturity} · ${f.statement.slice(0, 200)}`));
  L.push("", "ACTIVOS (asset · id · tipo · título · localidad · último precio · estado del precio):", ...m.assets.map((a) => `asset · ${a.id} · ${a.kind} · ${a.title} · ${a.locality ?? ""}${a.lastPrice ? ` · ${a.lastPrice.currency} ${a.lastPrice.amount} (${a.lastPrice.observed_on ?? "s/f"}${a.lastPrice.source_url ? `, aviso: ${a.lastPrice.source_url}` : ""})` : " · sin precio"}${a.price_status === "inconsistente" ? " · PRECIO INCONSISTENTE" : ""}`));
  L.push("", "EMPRESAS EN RELEVO/CRM (company · id · nombre · sector):", ...m.companies.map((c) => `company · ${c.id} · ${c.name}${c.sector ? ` · ${c.sector}` : ""}`));
  return L.join("\n");
}
