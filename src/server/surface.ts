import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WorkspaceContext } from "@/server/context";
import type { Discovery, EvidenceLevel } from "@/domain/discovery";
import { GAPS, type Gap } from "@/domain/readiness";
import type { MissionState } from "@/server/mission/state";

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

export type OpportunityView = { id: string; title: string; state: string; next: string | null; missing: string | null; href: string | null };

const sentence = (s: string) => s.trim().replace(/\.$/, "");
type Assessment = { created_at: string; summary: string | null; gaps: unknown; discovery: unknown };
const latest = (xs: Assessment[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

/**
 * Hipótesis no es oportunidad. Oportunidad = hay evidencia suficiente para justificar mover algo: las que el
 * equipo ya promovió y las hipótesis con casos verificados. Si no hay, se dice; como mucho se muestra lo que
 * está más cerca y qué le falta. Nunca se rellena.
 */
export async function opportunitiesView(db: Db): Promise<{ strong: OpportunityView[]; closest: OpportunityView[] }> {
  const [{ data: opps }, { data: findings }] = await Promise.all([
    db.from("opportunities").select("id, title, thesis, status, stage, next_action").neq("status", "rechazada").order("updated_at", { ascending: false }).limit(20),
    db.from("findings").select("id, statement, review_status, finding_assessments(created_at, summary, gaps, discovery)").eq("case_status", "activo").neq("review_status", "rechazado").limit(80),
  ]);
  const read = (findings ?? []).map((f) => {
    const a = latest(f.finding_assessments as Assessment[]);
    const d = (a?.discovery ?? null) as Discovery | null;
    const level = d?.evidence_level ?? "nula";
    const helper = d?.who_can_help?.[0];
    const gap = ((a?.gaps ?? []) as Gap[]).map((g) => GAPS[g]?.why as string | undefined).find(Boolean) ?? null;
    return {
      level, score: WEIGHT[level] + ((d?.signal_refs?.length ?? 0) > 0 ? 0.5 : 0) + ((d?.evidence_refs?.length ?? 0) > 0 ? 0.5 : 0),
      view: { id: f.id, title: sentence(f.statement), state: STATE[level], next: helper ? `Hablar con ${helper.name.split("·")[0].trim()}` : null, missing: gap, href: `o/${f.id}` },
    };
  });
  const strong: OpportunityView[] = [
    ...(opps ?? []).map((o) => ({ id: o.id, title: sentence(o.title), state: o.thesis ?? "La promovimos a oportunidad.", next: o.next_action, missing: null, href: null })),
    ...read.filter((x) => x.level === "alta").map((x) => x.view),
  ];
  const closest = read.filter((x) => x.level !== "alta" && x.score >= 1).sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.view);
  return { strong, closest };
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

export type LookItem = { id: string; kicker: string; title: string; line: string | null; ask: string; links?: string[]; then?: string | null };

const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 20 ? "hoy" : h < 44 ? "ayer" : `hace ${Math.round(h / 24)} días`;
};
const CHANGE: Record<string, string> = { nuevo: "nuevo", actualizado: "cambió", confirmado: "se confirmó", contradicho: "lo contradice", descartado: "descartado" };

/**
 * Lo que RELEVO encontró sin que se lo pidieran, con criterio: solo lo que toca algo que seguimos (una
 * hipótesis, una empresa, un activo) o es de relevancia alta. Cada cosa dice con qué se relaciona y qué haría.
 */
export async function whileAway(db: Db, missionShort: string | null): Promise<LookItem[]> {
  const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const { data } = await db
    .from("brief_signals")
    .select("id, headline, why_it_matters, reading, suggested_action, relevance, change, created_at, geography, finding_ids, company_ids, asset_ids")
    .in("relevance", ["alta", "media"])
    .neq("change", "descartado")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);
  const touches = (s: { finding_ids: string[]; company_ids: string[]; asset_ids: string[] }) => s.finding_ids.length + s.company_ids.length + s.asset_ids.length;
  const picked = (data ?? [])
    .filter((s) => s.relevance === "alta" || touches(s) > 0)
    .sort((a, b) => Number(b.relevance === "alta") - Number(a.relevance === "alta") || touches(b) - touches(a) || b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const fIds = [...new Set(picked.flatMap((s) => s.finding_ids))];
  const cIds = [...new Set(picked.flatMap((s) => s.company_ids))];
  const aIds = [...new Set(picked.flatMap((s) => s.asset_ids))];
  const [{ data: fs }, { data: cs }, { data: as }] = await Promise.all([
    fIds.length ? db.from("findings").select("id, statement").in("id", fIds) : Promise.resolve({ data: [] as { id: string; statement: string }[] }),
    cIds.length ? db.from("companies").select("id, trade_name, legal_name").in("id", cIds) : Promise.resolve({ data: [] as { id: string; trade_name: string | null; legal_name: string | null }[] }),
    aIds.length ? db.from("assets").select("id, title").in("id", aIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const fName = new Map((fs ?? []).map((f) => [f.id, `lo que creemos: «${sentence(f.statement)}»`]));
  const cName = new Map((cs ?? []).map((c) => [c.id, c.trade_name ?? c.legal_name ?? ""]));
  const aName = new Map((as ?? []).map((a) => [a.id, a.title.split("·")[0].trim()]));
  return picked.map((s) => ({
    id: s.id,
    kicker: `${missionShort ?? s.geography ?? "Señal"} · ${ago(s.created_at)} · ${CHANGE[s.change] ?? s.change}`,
    title: s.headline,
    line: (s.reading ?? s.why_it_matters)?.split(/(?<=\.)\s/)[0] ?? null,
    links: [...s.company_ids.map((id) => cName.get(id)), ...s.asset_ids.map((id) => aName.get(id)), ...s.finding_ids.map((id) => fName.get(id))].filter((x): x is string => !!x).slice(0, 3),
    then: s.suggested_action ?? null,
    ask: `Contame de esto y qué cambia para nosotros: ${s.headline}`,
  }));
}
// ---------------------------------------------------------------------------
// Misión: qué estamos intentando conseguir y qué sabemos. El estado lo prepara RELEVO por detrás; los números
// son vivos.
// ---------------------------------------------------------------------------

export type MissionCounts = { companies: number; people: number; assets: number; hypotheses: number; evidence: number; signals: number };

export async function missionCounts(db: Db): Promise<MissionCounts> {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [companies, people, assets, hypotheses, evidence, signals] = await Promise.all([
    count(db.from("companies").select("id", { count: "exact", head: true }).eq("is_demo", false)),
    count(db.from("contacts").select("id", { count: "exact", head: true })),
    count(db.from("assets").select("id", { count: "exact", head: true }).eq("is_demo", false)),
    count(db.from("findings").select("id", { count: "exact", head: true }).eq("case_status", "activo").neq("review_status", "rechazado")),
    count(db.from("evidence").select("id", { count: "exact", head: true })),
    count(db.from("brief_signals").select("id", { count: "exact", head: true })),
  ]);
  return { companies, people, assets, hypotheses, evidence, signals };
}

/** "Ya conozco 102 empresas, 50 personas, 13 activos y 20 hipótesis." */
export function knowsLine(c: MissionCounts): string {
  const parts = [
    c.companies && `${c.companies} empresas`,
    c.people && `${c.people} personas`,
    c.assets && `${c.assets} activos`,
    c.hypotheses && `${c.hypotheses} hipótesis`,
  ].filter(Boolean) as string[];
  if (!parts.length) return "";
  return `Ya conozco ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0]}.`;
}

export async function missionState(db: Db, missionId: string): Promise<MissionState | null> {
  const { data } = await db.from("campaigns").select("synthesis").eq("id", missionId).maybeSingle();
  return ((data?.synthesis as { state?: MissionState } | null)?.state ?? null);
}
