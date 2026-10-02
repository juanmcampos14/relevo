import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WorkspaceContext } from "@/server/context";
import type { Discovery, EvidenceLevel } from "@/domain/discovery";
import { GAPS, type Gap } from "@/domain/readiness";

// Lo común de las pantallas de RELEVO (Surface): cómo saludar a la persona y en qué misión estamos.

type Db = SupabaseClient<Database>;

export type SurfaceMission = { id: string; short: string; label: string };

export async function surfaceHello(db: Db, ctx: WorkspaceContext): Promise<{ greeting: string; name: string | null; mission: SurfaceMission | null }> {
  const [{ data: me }, { data: m }] = await Promise.all([
    db.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    db.from("campaigns").select("id, name, starts_on").eq("kind", "mision").eq("status", "activa").order("starts_on", { ascending: true, nullsFirst: false }).limit(1).maybeSingle(),
  ]);
  const team = (ctx.workspace.settings as { team?: Record<string, { short?: string }> } | null)?.team ?? {};
  const name = team[ctx.user.id]?.short ?? me?.display_name?.trim().split(/\s+/)[0] ?? null;
  const hour = Number(new Intl.DateTimeFormat("es-AR", { hour: "numeric", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()));
  const greeting = `${hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches"}${name ? `, ${name}` : ""}.`;
  let mission: SurfaceMission | null = null;
  if (m) {
    const short = m.name.split("—")[0].trim();
    const d = m.starts_on ? Math.ceil((new Date(`${m.starts_on}T12:00:00-03:00`).getTime() - Date.now()) / 86_400_000) : null;
    mission = { id: m.id, short, label: `${short}${d !== null ? (d > 1 ? ` · faltan ${d} días` : d === 1 ? " · mañana" : d === 0 ? " · hoy" : " · en curso") : ""}` };
  }
  return { greeting, name, mission };
}

// ---------------------------------------------------------------------------
// Oportunidades: qué vale la pena perseguir y cuál es el próximo movimiento. Sale de las hipótesis del Brain
// con su lectura de discovery; la Surface muestra la conclusión y el paso, no los campos.
// ---------------------------------------------------------------------------

const STATE: Record<EvidenceLevel, string> = {
  alta: "Hay casos que lo sostienen. Vale la pena moverlo.",
  media: "Hay señales que vale la pena validar.",
  baja: "Hay una señal; falta confirmarla con quien compra.",
  nula: "Por ahora es una idea nuestra; falta la primera señal.",
};
const WEIGHT: Record<EvidenceLevel, number> = { alta: 3, media: 2, baja: 1, nula: 0 };

export type OpportunityView = { id: string; title: string; state: string; next: string | null; score: number };

const sentence = (s: string) => s.trim().replace(/\.$/, "");
type Assessment = { created_at: string; summary: string | null; gaps: unknown; discovery: unknown };
const latest = (xs: Assessment[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

export async function opportunitiesView(db: Db): Promise<OpportunityView[]> {
  const { data } = await db
    .from("findings")
    .select("id, statement, review_status, finding_assessments(created_at, summary, gaps, discovery)")
    .eq("case_status", "activo")
    .neq("review_status", "rechazado")
    .limit(80);
  return (data ?? [])
    .map((f) => {
      const d = (latest(f.finding_assessments as Assessment[])?.discovery ?? null) as Discovery | null;
      const level = d?.evidence_level ?? "nula";
      const helper = d?.who_can_help?.[0];
      const score = WEIGHT[level] + (helper ? 0.5 : 0) + ((d?.signal_refs?.length ?? 0) > 0 ? 0.5 : 0) + (f.review_status === "aprobado" ? 0.5 : 0);
      return { id: f.id, title: sentence(f.statement), state: STATE[level], next: helper ? `Hablar con ${helper.name.split("·")[0].trim()}` : null, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Profundidad de una oportunidad: la misma lectura del Brain, en capas (por qué, qué no sabemos, quiénes
// ayudan, lo que encontramos, empresas, señales). Aparece cuando se pide.
// ---------------------------------------------------------------------------

export type DepthView = {
  id: string; title: string; state: string; belief: string | null; why: string | null; summary: string | null;
  unknowns: string[];
  helpers: { name: string; why: string; ask: string }[];
  evidence: { text: string; stance: "a favor" | "en contra" | "contexto"; source: string | null; url: string | null; verified: boolean }[];
  companies: { name: string; role: string }[];
  signals: { headline: string; url: string | null; on: string | null }[];
};

const ROLE: Record<string, string> = { universo: "en el mapa", afectada: "le pasa", compradora: "compra", proveedora: "provee" };

export async function depthView(db: Db, findingId: string): Promise<DepthView | null> {
  const { data: f } = await db
    .from("findings")
    .select("id, statement, finding_assessments(created_at, summary, gaps, discovery), finding_companies(role, companies(trade_name, legal_name)), finding_evidence(stance, evidence(statement, verification_status, sources(title, url)))")
    .eq("id", findingId)
    .maybeSingle();
  if (!f) return null;
  const a = latest(f.finding_assessments as Assessment[]);
  const d = (a?.discovery ?? null) as Discovery | null;
  const signalIds = (d?.signal_refs ?? []).map((r) => r.split(":")[1]).filter(Boolean);
  const { data: sig } = signalIds.length ? await db.from("brief_signals").select("headline, source_url, happened_on").in("id", signalIds) : { data: [] };
  const gaps: string[] = ((a?.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.why as string | undefined).filter((x): x is string => !!x);
  return {
    id: f.id,
    title: sentence(f.statement),
    state: STATE[d?.evidence_level ?? "nula"],
    belief: d?.belief ?? null,
    why: d?.why ?? null,
    summary: a?.summary ?? null,
    unknowns: gaps.slice(0, 5),
    helpers: (d?.who_can_help ?? []).slice(0, 5).map((h) => ({ name: h.name, why: h.why, ask: h.ask })),
    evidence: (f.finding_evidence ?? []).filter((x) => x.evidence).map((x) => ({
      text: x.evidence!.statement,
      stance: x.stance === "supports" ? "a favor" : x.stance === "contradicts" ? "en contra" : "contexto",
      source: x.evidence!.sources?.title ?? null,
      url: x.evidence!.sources?.url ?? null,
      verified: x.evidence!.verification_status === "verified",
    })),
    companies: (f.finding_companies ?? []).filter((x) => x.companies).map((x) => ({ name: x.companies!.trade_name ?? x.companies!.legal_name ?? "", role: ROLE[x.role] ?? x.role })),
    signals: (sig ?? []).map((s) => ({ headline: s.headline, url: s.source_url, on: s.happened_on })),
  };
}

// ---------------------------------------------------------------------------
// Explorar: qué hay para mirar. Lo que apareció mientras la persona no estaba (señales que importan) y lo
// que hay cerca de donde está (memoria del Brain).
// ---------------------------------------------------------------------------

export type LookItem = { id: string; kicker: string; title: string; line: string | null; ask: string };

const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 20 ? "hoy" : h < 44 ? "ayer" : `hace ${Math.round(h / 24)} días`;
};

export async function whileAway(db: Db, missionShort: string | null): Promise<LookItem[]> {
  const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const { data } = await db
    .from("brief_signals")
    .select("id, headline, why_it_matters, relevance, change, created_at, geography")
    .in("relevance", ["alta", "media"])
    .neq("change", "descartado")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? [])
    .sort((a, b) => Number(b.relevance === "alta") - Number(a.relevance === "alta") || b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
    .map((s) => ({ id: s.id, kicker: `${missionShort ?? s.geography ?? "Señal"} · ${ago(s.created_at)}`, title: s.headline, line: s.why_it_matters ? s.why_it_matters.split(/(?<=\.)\s/)[0] : null, ask: `Contame de esto: ${s.headline}` }));
}
