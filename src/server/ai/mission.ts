import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GAPS, type Gap } from "@/domain/readiness";
import { PURPOSES, type Discovery } from "@/domain/discovery";
import { companyName } from "@/server/entities";

// Mission brief: en una sola llamada, lo que el Brain sabe de una misión (fechas, hipótesis y sus gaps,
// a quién contactar, follow-ups, agenda, AOG, activos, señales). Es materia prima: el modelo sintetiza
// "esto es lo importante ahora", no repite el volcado.

type Db = SupabaseClient<Database>;
const ref = (type: string, id: string) => `${type}:${id}`;
const clip = (s: string | null | undefined, n = 240) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? null);
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function missionBrief(db: Db, campaignId: string | null, today = new Date(), opts: { withSynthesis?: boolean } = { withSynthesis: true }) {
  const { data: missions } = campaignId
    ? await db.from("campaigns").select("id, name, kind, objective, zone, status, starts_on, ends_on, synthesis, synthesized_at").eq("id", campaignId).limit(1)
    : await db.from("campaigns").select("id, name, kind, objective, zone, status, starts_on, ends_on, synthesis, synthesized_at").eq("kind", "mision").eq("status", "activa").order("starts_on", { ascending: true, nullsFirst: false }).limit(1);
  const mission = missions?.[0];
  if (!mission) return null;
  const t = day(today);
  const until = mission.ends_on ?? day(new Date(today.getTime() + 30 * 86_400_000));
  const week = new Date(today.getTime() - 7 * 86_400_000).toISOString();

  const [{ data: docs }, { data: findings }, { data: aog }, { data: drafts }, { data: targets }, { data: tasks }, { data: plans }, { data: assets }, { data: stories }, { data: signals }, evidence7, captures7, estabGeo, estabAll, assetsGeo] = await Promise.all([
    db.from("context_documents").select("id, title, kind, summary").eq("status", "vigente"),
    db.from("findings").select("id, dedup_key, statement, maturity, finding_companies(count), question_findings(count), finding_assessments(created_at, summary, gaps, discovery, baseline_campaign_id)").neq("review_status", "rechazado").eq("case_status", "activo").or(`campaign_id.eq.${mission.id},campaign_id.is.null`).limit(60),
    db.from("research_questions").select("id, code, industry, dimension, question, next_action").ilike("industry", "AOG%").order("code"),
    db.from("contacts").select("id, full_name, role_title, relationship_status, contact_links(companies(id, trade_name, legal_name))").not("outreach_draft", "is", null).limit(40),
    db.from("campaign_targets").select("id, status, priority, purpose, next_action, next_action_due, briefing, companies(id, trade_name, legal_name)").eq("campaign_id", mission.id).limit(200),
    db.from("tasks").select("id, title, due_on, kind, channel, contact_id, contacts(full_name), campaign_targets(companies(id, trade_name, legal_name))").neq("status", "done").not("due_on", "is", null).lte("due_on", until).order("due_on").limit(60),
    db.from("visit_plans").select("id, title, planned_on, visit_stops(count)").gte("planned_on", t).lte("planned_on", until).order("planned_on"),
    db.from("assets").select("id, title, category, locality, price_status, latitude, asset_prices(amount, currency, operation, period, observed_on)").not("radar_ref", "is", null).limit(40),
    db.from("brief_stories").select("id, title, status, watch_reason, last_seen_on").neq("status", "cerrada").order("last_seen_on", { ascending: false }).limit(12),
    db.from("brief_signals").select("headline, basis, change, happened_on, publisher, source_url, vertical").gte("created_at", week).order("happened_on", { ascending: false, nullsFirst: false }).limit(12),
    db.from("evidence").select("id", { count: "exact", head: true }).gte("created_at", week),
    db.from("captures").select("id", { count: "exact", head: true }).gte("captured_at", week),
    db.from("establishments").select("id", { count: "exact", head: true }).not("latitude", "is", null),
    db.from("establishments").select("id", { count: "exact", head: true }),
    db.from("assets").select("id", { count: "exact", head: true }).not("latitude", "is", null),
  ]);

  const start = mission.starts_on ? new Date(`${mission.starts_on}T12:00:00-03:00`) : null;
  const daysToStart = start ? Math.ceil((start.getTime() - today.getTime()) / 86_400_000) : null;
  const latest = <T extends { created_at: string }>(xs: T[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const hypotheses = (findings ?? []).map((f) => {
    const as = latest(f.finding_assessments);
    const d = (as?.discovery ?? null) as Discovery | null;
    return {
      ref: ref("finding", f.id),
      code: f.dedup_key?.replace(/^crm:/, "") ?? null,
      statement: f.statement,
      maturity: f.maturity,
      analyzed: as ? as.created_at.slice(0, 10) : false,
      belief: d?.belief ?? null,
      evidence_level: d?.evidence_level ?? (as ? "sin capa de discovery" : "sin analizar"),
      gaps: ((as?.gaps ?? []) as Gap[]).slice(0, 4).map((g) => GAPS[g]?.label ?? g),
      who_can_help: (d?.who_can_help ?? []).slice(0, 3).map((h) => ({ ref: h.ref, name: h.name, purpose: PURPOSES[h.purpose], ask: h.ask })),
      companies: f.finding_companies[0]?.count ?? 0,
      questions: f.question_findings[0]?.count ?? 0,
      baseline_taken: f.finding_assessments.some((x) => x.baseline_campaign_id === mission.id),
    };
  });

  const byPriority = (targets ?? []).reduce<Record<string, number>>((acc, x) => ((acc[String(x.priority ?? "s/p")] = (acc[String(x.priority ?? "s/p")] ?? 0) + 1), acc), {});
  const highNoAction = (targets ?? []).filter((x) => x.priority === 1 && !x.next_action && x.companies);
  const overdue = (tasks ?? []).filter((x) => x.due_on! < t);

  type B = { this_week?: boolean; today?: boolean; why?: string; objective?: string; we_need?: string; attention?: string | null; purpose?: string; contact?: { ref: string; name: string } | null };
  const shortlist = (targets ?? [])
    .filter((x) => x.companies && x.briefing && ((x.briefing as B).this_week || (x.briefing as B).today))
    .map((x) => {
      const b = x.briefing as B;
      return { company: { ref: ref("company", x.companies!.id), name: companyName(x.companies!) }, person: b.contact ?? null, today: !!b.today, purpose: b.purpose ? PURPOSES[b.purpose as keyof typeof PURPOSES] : null, why: b.why, need: b.we_need, objective: b.objective, attention: b.attention ?? null };
    })
    .sort((a, b) => Number(b.today) - Number(a.today));
  const synthesisAgeH = mission.synthesized_at ? (today.getTime() - new Date(mission.synthesized_at).getTime()) / 3_600_000 : null;

  return {
    // Lo que RELEVO ya preparó (en background): respondé desde acá primero.
    ...(opts.withSynthesis && mission.synthesis
      ? { prepared: { synthesis: mission.synthesis, computed_hours_ago: synthesisAgeH === null ? null : Math.round(synthesisAgeH), stale: synthesisAgeH !== null && synthesisAgeH > 30 } }
      : {}),
    contacts_to_move: { count: shortlist.length, attention_today: shortlist.filter((x) => x.today).length, items: shortlist.slice(0, 20) },
    mission: {
      ref: ref("campaign", mission.id),
      name: mission.name,
      objective: mission.objective,
      zone: mission.zone,
      dates: { from: mission.starts_on, to: mission.ends_on },
      today: t,
      days_to_start: daysToStart,
      moment: daysToStart === null ? "sin fechas" : daysToStart > 0 ? "preparación" : mission.ends_on && t > mission.ends_on ? "cerrada / síntesis" : "en curso",
      plan_documents: (docs ?? []).map((x) => ({ ref: ref("document", x.id), title: x.title, kind: x.kind, summary: clip(x.summary, 400) })),
    },
    hypotheses: {
      total: hypotheses.length,
      analyzed: hypotheses.filter((h) => h.analyzed).length,
      baseline_taken: hypotheses.filter((h) => h.baseline_taken).length,
      items: hypotheses,
    },
    targets: {
      total: (targets ?? []).length,
      by_priority: byPriority,
      with_purpose: (targets ?? []).filter((x) => x.purpose).length,
      high_priority_without_next_action: { count: highNoAction.length, examples: highNoAction.slice(0, 6).map((x) => ({ ref: ref("company", x.companies!.id), name: companyName(x.companies!) })) },
    },
    outreach_ready: (drafts ?? []).map((c) => ({ ref: ref("contact", c.id), name: c.full_name, role: c.role_title, relationship: c.relationship_status, company: c.contact_links[0]?.companies ? { ref: ref("company", c.contact_links[0].companies.id), name: companyName(c.contact_links[0].companies) } : null })),
    follow_ups: {
      overdue: overdue.length,
      until_end_of_mission: (tasks ?? []).length,
      next: (tasks ?? []).slice(0, 15).map((x) => ({ ref: ref("task", x.id), title: clip(x.title, 160), due_on: x.due_on, channel: x.channel, with: x.contacts?.full_name ?? null, company: x.campaign_targets?.companies ? { ref: ref("company", x.campaign_targets.companies.id), name: companyName(x.campaign_targets.companies) } : null })),
    },
    agenda: (plans ?? []).map((p) => ({ title: p.title, on: p.planned_on, stops: p.visit_stops[0]?.count ?? 0 })),
    aog_scripts: (aog ?? []).map((q) => ({ code: q.code, entity: q.industry?.replace(/^AOG\s*·\s*/, "") ?? null, topic: q.dimension, opening: clip(q.question, 300), next_action: q.next_action })),
    assets: (assets ?? []).map((a) => {
      const p = [...a.asset_prices].sort((x, y) => (y.observed_on ?? "").localeCompare(x.observed_on ?? ""))[0];
      return { ref: ref("asset", a.id), title: a.title, category: a.category, locality: a.locality, last_price: p ? `${p.currency} ${Number(p.amount).toLocaleString("es-AR")}${p.period ? `/${p.period}` : ""}` : null, prices_seen: a.asset_prices.length, price_status: a.price_status === "inconsistente" ? "PRECIO INCONSISTENTE" : a.price_status, located: a.latitude !== null };
    }),
    stories: (stories ?? []).map((s) => ({ title: s.title, status: s.status, watch_reason: s.watch_reason, last_seen_on: s.last_seen_on })),
    recent_signals: (signals ?? []).map((s) => ({ headline: s.headline, basis: s.basis, change: s.change, on: s.happened_on, publisher: s.publisher, source: s.source_url, vertical: s.vertical })),
    last_7_days: { new_evidence: evidence7.count ?? 0, captures: captures7.count ?? 0, signals: (signals ?? []).length },
    locations: { establishments_located: estabGeo.count ?? 0, establishments_total: estabAll.count ?? 0, assets_located: assetsGeo.count ?? 0 },
    notes: [
      "El diseño del equipo (hipótesis y preguntas) no es evidencia: es lo que creemos y cómo pensamos validarlo.",
      "Investigamos para cerrar gaps: priorizá lo que reduce incertidumbre de las hipótesis con más en juego.",
      "Precios distintos de un mismo activo = PRECIO INCONSISTENTE; nunca una baja calculada.",
    ],
  };
}

