import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WorkspaceContext } from "@/server/context";
import type { Discovery, EvidenceLevel } from "@/domain/discovery";
import { GAPS, type Gap } from "@/domain/readiness";
import type { MissionState } from "@/server/mission/state";
import { chosenMission, listMissions, type MissionOption } from "@/server/mission/current";

// Lo común de las pantallas de RELEVO (Surface): cómo saludar a la persona y en qué misión estamos.

type Db = SupabaseClient<Database>;

export type SurfaceMission = { id: string; short: string; label: string };

export type MissionMembership = { role: "owner" | "member" | "viewer" | null; joinedAt: string | null; lastSeenAt: string | null; invitedBy: string | null; crew: number };

export async function surfaceHello(db: Db, ctx: WorkspaceContext): Promise<{ greeting: string; name: string | null; mission: SurfaceMission | null; missions: MissionOption[]; chosen: boolean; membership: MissionMembership; canEdit: boolean }> {
  const [{ data: me }, missions, chosen] = await Promise.all([
    db.from("profiles").select("display_name").eq("user_id", ctx.user.id).maybeSingle(),
    listMissions(db),
    chosenMission(db),
  ]);
  const id = chosen ?? missions[0]?.id ?? null;
  const { data: m } = id ? await db.from("campaigns").select("id, name, starts_on").eq("id", id).maybeSingle() : { data: null };
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
  // Mi lugar en esta misión (owner, puede trabajar o solo ver) y cuándo la miré por última vez.
  const { data: me2 } = m ? await db.from("campaign_members").select("role, joined_at, last_seen_at, invited_by").eq("campaign_id", m.id).eq("user_id", ctx.user.id).maybeSingle() : { data: null };
  const { count: crew } = m ? await db.from("campaign_members").select("user_id", { count: "exact", head: true }).eq("campaign_id", m.id).in("role", ["owner", "member"]) : { count: 0 };
  const membership: MissionMembership = { role: (me2?.role as MissionMembership["role"]) ?? null, joinedAt: me2?.joined_at ?? null, lastSeenAt: me2?.last_seen_at ?? null, invitedBy: me2?.invited_by ?? null, crew: crew ?? 0 };
  return { greeting, name, mission, missions, chosen: !!chosen, membership, canEdit: ctx.canEdit && membership.role !== "viewer" };
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
export async function opportunitiesView(db: Db, missionId: string | null): Promise<{ strong: OpportunityView[]; closest: OpportunityView[] }> {
  const m = missionId ?? "00000000-0000-0000-0000-000000000000";
  const [{ data: opps }, { data: findings }] = await Promise.all([
    db.from("opportunities").select("id, title, thesis, status, stage, next_action").eq("campaign_id", m).neq("status", "rechazada").order("updated_at", { ascending: false }).limit(20),
    db.from("findings").select("id, statement, review_status, finding_assessments(created_at, summary, gaps, discovery)").eq("campaign_id", m).eq("case_status", "activo").neq("review_status", "rechazado").limit(80),
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

export type LookItem = { id: string; kicker: string; title: string; line: string | null; ask: string; links?: string[]; then?: string | null; scope?: string; map?: string | null };

const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 20 ? "hoy" : h < 44 ? "ayer" : `hace ${Math.round(h / 24)} días`;
};
const CHANGE: Record<string, string> = { nuevo: "nuevo", actualizado: "cambió", confirmado: "se confirmó", contradicho: "lo contradice", descartado: "descartado" };

/**
 * Lo que RELEVO encontró sin que se lo pidieran, con criterio: solo lo que toca algo que seguimos (una
 * hipótesis, una empresa, un activo) o es de relevancia alta. Cada cosa dice con qué se relaciona y qué haría.
 */
export async function whileAway(db: Db, missionShort: string | null, missionId: string | null): Promise<LookItem[]> {
  if (!missionId) return [];
  const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const { data } = await db
    .from("brief_signals")
    .select("id, headline, why_it_matters, reading, suggested_action, relevance, change, created_at, geography, finding_ids, company_ids, asset_ids")
    .contains("campaign_ids", [missionId])
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

/**
 * Lo que RELEVO conoce en el contexto de esta misión. La memoria es global; acá cuenta lo que la misión toca:
 * empresas y activos que sigue, personas vigentes en esas empresas, hipótesis, evidencia y señales de la misión.
 */
export async function missionCounts(db: Db, missionId: string | null): Promise<MissionCounts> {
  if (!missionId) return { companies: 0, people: 0, assets: 0, hypotheses: 0, evidence: 0, signals: 0 };
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [{ data: targets }, { data: fc }, hypotheses, evidence, signals] = await Promise.all([
    db.from("campaign_targets").select("company_id, asset_id").eq("campaign_id", missionId).neq("status", "descartado"),
    db.from("finding_companies").select("company_id, findings!inner(campaign_id)").eq("findings.campaign_id", missionId),
    count(db.from("findings").select("id", { count: "exact", head: true }).eq("campaign_id", missionId).eq("case_status", "activo").neq("review_status", "rechazado")),
    count(db.from("evidence").select("id", { count: "exact", head: true }).eq("campaign_id", missionId)),
    count(db.from("brief_signals").select("id", { count: "exact", head: true }).contains("campaign_ids", [missionId])),
  ]);
  const companies = [...new Set([...(targets ?? []).map((t) => t.company_id), ...(fc ?? []).map((x) => x.company_id)].filter((x): x is string => !!x))];
  const assets = new Set((targets ?? []).map((t) => t.asset_id).filter(Boolean)).size;
  const people = (await missionPeople(db, missionId)).length;
  return { companies: companies.length, people, assets, hypotheses, evidence, signals };
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

// ---------------------------------------------------------------------------
// Lo que RELEVO aprendió solo y lo que necesita preguntar (una pregunta, no una bandeja).
// ---------------------------------------------------------------------------

export type Question = { id: string; question: string; detail: string | null; kind: string };
export type Learned = { id: string; summary: string; at: string; undone: boolean };

export async function missionQuestions(db: Db, missionId: string | null): Promise<Question[]> {
  if (!missionId) return [];
  const { data } = await db.from("brief_candidates").select("id, question, detail, kind").eq("campaign_id", missionId).eq("status", "candidato").not("question", "is", null).order("created_at", { ascending: false }).limit(2);
  return (data ?? []).map((q) => ({ id: q.id, question: q.question!, detail: q.detail, kind: q.kind }));
}

export async function learnedAlone(db: Db, missionId: string | null): Promise<Learned[]> {
  if (!missionId) return [];
  const { data } = await db.from("ai_action_drafts").select("id, rationale, decided_at, status, after_state").eq("action", "ingest_candidate").in("status", ["ejecutada", "deshecha"]).gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(20);
  return (data ?? []).filter((d) => (d.after_state as { mission_id?: string } | null)?.mission_id === missionId).slice(0, 5).map((d) => ({ id: d.id, summary: d.rationale ?? "", at: d.decided_at ?? "", undone: d.status === "deshecha" }));
}

export type MissionPerson = { id: string; name: string; role: string | null; links: { with: string; current: boolean; until: string | null }[]; why: string };

/**
 * Las personas que la misión conoce (el número de "Lo que ya conozco" sale de acá, y se puede preguntar quiénes
 * son): vinculadas a una empresa o un activo que la misión sigue (vigente o anterior: cambiar de trabajo no saca
 * a nadie de la memoria), dueñas de un activo de la misión, o nombradas en su evidencia o en sus tareas.
 */
export async function missionPeople(db: Db, missionId: string): Promise<MissionPerson[]> {
  const [{ data: targets }, { data: fc }] = await Promise.all([
    db.from("campaign_targets").select("company_id, asset_id").eq("campaign_id", missionId).neq("status", "descartado"),
    db.from("finding_companies").select("company_id, findings!inner(campaign_id)").eq("findings.campaign_id", missionId),
  ]);
  const companies = [...new Set([...(targets ?? []).map((t) => t.company_id), ...(fc ?? []).map((x) => x.company_id)].filter((x): x is string => !!x))];
  const assets = [...new Set((targets ?? []).map((t) => t.asset_id).filter((x): x is string => !!x))];
  const out = new Map<string, MissionPerson>();
  const add = (id: string, name: string, role: string | null, why: string, link?: { with: string; current: boolean; until: string | null }) => {
    const p = out.get(id) ?? { id, name, role, links: [], why };
    if (link && !p.links.some((l) => l.with === link.with)) p.links.push(link);
    out.set(id, p);
  };
  for (let i = 0; i < companies.length; i += 150) {
    const { data } = await db.from("contact_links").select("valid_until, contacts(id, full_name, role_title), companies(trade_name, legal_name)").in("company_id", companies.slice(i, i + 150));
    for (const l of data ?? []) if (l.contacts) add(l.contacts.id, l.contacts.full_name, l.contacts.role_title, "trabaja o trabajó en una empresa de la misión", { with: l.companies?.trade_name ?? l.companies?.legal_name ?? "", current: !l.valid_until, until: l.valid_until });
  }
  if (assets.length) {
    const [{ data: parties }, { data: links }] = await Promise.all([
      db.from("asset_parties").select("role, contacts(id, full_name, role_title), assets(title)").in("asset_id", assets).not("contact_id", "is", null),
      db.from("contact_links").select("valid_until, contacts(id, full_name, role_title), assets(title)").in("asset_id", assets),
    ]);
    for (const p of parties ?? []) if (p.contacts) add(p.contacts.id, p.contacts.full_name, p.contacts.role_title, `${p.role} de un activo de la misión`, { with: p.assets?.title ?? "", current: true, until: null });
    for (const l of links ?? []) if (l.contacts) add(l.contacts.id, l.contacts.full_name, l.contacts.role_title, "vinculada a un activo de la misión", { with: l.assets?.title ?? "", current: !l.valid_until, until: l.valid_until });
  }
  const [{ data: ev }, { data: tasks }] = await Promise.all([
    db.from("evidence").select("contact_id, stated_by_contact_id").eq("campaign_id", missionId),
    db.from("tasks").select("contact_id").eq("campaign_id", missionId).not("contact_id", "is", null),
  ]);
  const extra = [...new Set([...(ev ?? []).flatMap((e) => [e.contact_id, e.stated_by_contact_id]), ...(tasks ?? []).map((t) => t.contact_id)].filter((x): x is string => !!x && !out.has(x)))];
  if (extra.length) {
    const { data } = await db.from("contacts").select("id, full_name, role_title").in("id", extra);
    for (const c of data ?? []) add(c.id, c.full_name, c.role_title, "aparece en lo que sabemos o hacemos en la misión");
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Equipo: recibir a quien entra a una misión que ya empezó, y contarle a cada uno qué aportaron los demás
// desde su última visita (no un activity feed: una línea por persona y qué haría).
// ---------------------------------------------------------------------------

export type Notice = { title: string; lines: string[]; actions: { label: string; ask?: string; focus?: boolean }[] };

const namesOf = async (db: Db, ctx: WorkspaceContext, ids: string[]) => {
  const team = (ctx.workspace.settings as { team?: Record<string, { short?: string }> } | null)?.team ?? {};
  const { data } = ids.length ? await db.from("profiles").select("user_id, display_name, email").in("user_id", ids) : { data: [] };
  return new Map(ids.map((id) => {
    const p = (data ?? []).find((x) => x.user_id === id);
    return [id, team[id]?.short ?? p?.display_name?.split(/\s+/)[0] ?? p?.email?.split("@")[0] ?? "Alguien"] as const;
  }));
};

export async function welcomeNotice(db: Db, ctx: WorkspaceContext, hello: { name: string | null; mission: SurfaceMission | null; membership: MissionMembership }): Promise<Notice | null> {
  const m = hello.mission;
  if (!m || hello.membership.lastSeenAt || hello.membership.role === "owner" || !hello.membership.role) return null;
  const [state, counts] = await Promise.all([missionState(db, m.id), missionCounts(db, m.id)]);
  const inviter = hello.membership.invitedBy ? (await namesOf(db, ctx, [hello.membership.invitedBy])).get(hello.membership.invitedBy) : null;
  // Narrativa, no inventario: la historia de la misión contada por RELEVO para quien llega tarde.
  const lines = state?.story
    ? [state.story]
    : [state?.purpose ?? null, knowsLine(counts) || null, state?.since_start?.learned || state?.changed?.[0] || null].filter((x): x is string => !!x);
  return {
    title: `${hello.name ? `${hello.name}, ` : ""}${inviter ? `${inviter} te sumó` : "te sumaron"} a ${m.short}.`,
    lines,
    actions: [
      { label: "Poneme al día", ask: "Poneme al día" },
      { label: "Primero te cuento lo que sé", focus: true },
    ],
  };
}

/** Marca que la persona ya miró la misión (para el onboarding y el "desde tu última visita"). */
export async function markSeen(db: Db, missionId: string, userId: string): Promise<void> {
  await db.from("campaign_members").update({ last_seen_at: new Date().toISOString() }).eq("campaign_id", missionId).eq("user_id", userId);
}
