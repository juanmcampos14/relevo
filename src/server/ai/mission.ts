import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GAPS, type Gap } from "@/domain/readiness";
import { PURPOSES, type Discovery } from "@/domain/discovery";
import { companyName } from "@/server/entities";
import { correctionsForBrain, visible, type Focus } from "@/domain/focus";

// Mission brief: en una sola llamada, lo que el Brain sabe de una misión (fechas, hipótesis y sus gaps,
// a quién contactar, follow-ups, agenda, AOG, activos, señales). Es materia prima: el modelo sintetiza
// "esto es lo importante ahora", no repite el volcado.

type Db = SupabaseClient<Database>;
const ref = (type: string, id: string) => `${type}:${id}`;
const clip = (s: string | null | undefined, n = 240) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? null);
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function missionBrief(db: Db, campaignId: string | null, today = new Date(), opts: { withSynthesis?: boolean } = { withSynthesis: true }) {
  const { data: missions } = campaignId
    ? await db.from("campaigns").select("id, name, kind, objective, zone, status, starts_on, ends_on, synthesis, synthesized_at, watch").eq("id", campaignId).limit(1)
    : await db.from("campaigns").select("id, name, kind, objective, zone, status, starts_on, ends_on, synthesis, synthesized_at, watch").eq("kind", "mision").eq("status", "activa").order("starts_on", { ascending: true, nullsFirst: false }).limit(1);
  const mission = missions?.[0];
  if (!mission) return null;
  const t = day(today);
  const until = mission.ends_on ?? day(new Date(today.getTime() + 30 * 86_400_000));
  const week = new Date(today.getTime() - 7 * 86_400_000).toISOString();

  const [{ data: docs }, { data: findings }, { data: aog }, { data: drafts }, { data: targets }, { data: tasks }, { data: plans }, { data: assets }, { data: stories }, { data: signals }, evidence7, captures7, estabGeo, estabAll, assetsGeo] = await Promise.all([
    db.from("context_documents").select("id, title, kind, summary").eq("status", "vigente").or(`campaign_id.eq.${mission.id},campaign_id.is.null`),
    db.from("findings").select("id, dedup_key, statement, maturity, finding_companies(count), question_findings(count), finding_assessments(created_at, summary, gaps, discovery, baseline_campaign_id)").neq("review_status", "rechazado").eq("case_status", "activo").eq("campaign_id", mission.id).limit(60),
    db.from("research_questions").select("id, code, industry, dimension, question, next_action").eq("campaign_id", mission.id).ilike("industry", "AOG%").order("code"),
    db.from("contacts").select("id, full_name, role_title, relationship_status, contact_links(valid_until, companies(id, trade_name, legal_name))").not("outreach_draft", "is", null).limit(80),
    db.from("campaign_targets").select("id, status, priority, purpose, next_action, next_action_due, briefing, companies(id, trade_name, legal_name)").eq("campaign_id", mission.id).neq("status", "descartado").limit(200),
    db.from("tasks").select("id, title, due_on, kind, channel, contact_id, contacts(full_name), campaign_targets(companies(id, trade_name, legal_name))").eq("campaign_id", mission.id).neq("status", "done").not("due_on", "is", null).lte("due_on", until).order("due_on").limit(60),
    db.from("visit_plans").select("id, title, planned_on, visit_stops(count)").eq("campaign_id", mission.id).gte("planned_on", t).lte("planned_on", until).order("planned_on"),
    db.from("campaign_targets").select("status, assets!inner(id, title, category, locality, price_status, latitude, asset_prices(amount, currency, operation, period, observed_on))").eq("campaign_id", mission.id).neq("status", "descartado").not("asset_id", "is", null).limit(40),
    // Las historias del Morning Brief son de la misión que el Brief sigue (la primera).
    db.from("brief_stories").select("id, title, status, watch_reason, last_seen_on").neq("status", "cerrada").order("last_seen_on", { ascending: false }).limit((await isBriefMission(db, mission.id)) ? 12 : 0),
    db.from("brief_signals").select("headline, basis, change, happened_on, publisher, source_url, vertical").contains("campaign_ids", [mission.id]).gte("created_at", week).order("happened_on", { ascending: false, nullsFirst: false }).limit(12),
    db.from("evidence").select("id", { count: "exact", head: true }).eq("campaign_id", mission.id).gte("created_at", week),
    db.from("captures").select("id", { count: "exact", head: true }).eq("campaign_id", mission.id).gte("captured_at", week),
    db.from("establishments").select("id", { count: "exact", head: true }).not("latitude", "is", null),
    db.from("establishments").select("id", { count: "exact", head: true }),
    db.from("assets").select("id", { count: "exact", head: true }).not("latitude", "is", null),
  ]);

  const missionCompanies = new Set((targets ?? []).map((x) => x.companies?.id).filter((x): x is string => !!x));
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

  // Actualización operativa inmediata: lo que pasó DESPUÉS de preparar la síntesis (sin otra corrida de IA).
  // La conversación ya sabe lo que la persona acaba de hacer, aunque la síntesis profunda se rehaga más tarde.
  const after = mission.synthesized_at ?? t;
  const [{ data: applied }, { data: closed }, { data: caps }] = opts.withSynthesis && mission.synthesis
    ? await Promise.all([
        db.from("ai_action_drafts").select("rationale, decided_at").eq("action", "contact_event").eq("status", "ejecutada").gt("decided_at", after).order("decided_at"),
        db.from("tasks").select("id, title").eq("campaign_id", mission.id).eq("status", "done").gt("completed_at", after).limit(30),
        db.from("captures").select("id, ai_summary, captured_at").eq("campaign_id", mission.id).gt("captured_at", after).order("captured_at").limit(10),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const doneTasks = new Set((closed ?? []).map((x) => ref("task", x.id)));
  type Item = { title: string; why: string; refs: string[]; done?: boolean };
  const mark = (xs: Item[] = []) => xs.map((x) => { const tasks = x.refs.filter((r) => r.startsWith("task:")); return tasks.length && tasks.every((r) => doneTasks.has(r)) ? { ...x, done: true } : x; });
  const prepared = mission.synthesis as { today?: Item[]; this_week?: Item[]; focus?: Focus } | null;
  // Lo que hoy se ve en el home (el foco vivo, con las correcciones de la persona) manda sobre la síntesis.
  const focusNow = prepared?.focus?.items ? visible(prepared.focus, today) : null;
  const { focus: _f, aog: _a, state: _s, ...rest } = (prepared ?? {}) as { focus?: unknown; aog?: unknown; state?: unknown } & Record<string, unknown>;
  void _f; void _a; void _s;
  const live = prepared
    ? { ...rest, today: mark(prepared.today), this_week: mark(prepared.this_week), ...(focusNow ? { now_on_home: focusNow.map((x) => ({ focus_id: x.id, title: x.title, why: x.why, refs: x.refs, done_with: x.done_refs ?? [] })), recent_corrections: correctionsForBrain(prepared.focus!, today).slice(0, 6) } : {}) }
    : null;
  const sincePrepared = {
    actions: (applied ?? []).map((x) => ({ what: x.rationale, at: x.decided_at })),
    tasks_closed: (closed ?? []).map((x) => ({ ref: ref("task", x.id), title: clip(x.title, 140) })),
    captures: (caps ?? []).map((x) => ({ ref: ref("capture", x.id), summary: clip(x.ai_summary, 200), at: x.captured_at })),
  };

  return {
    // Lo que RELEVO ya preparó (en background): respondé desde acá primero.
    ...(opts.withSynthesis && mission.synthesis
      ? { prepared: { synthesis: live, computed_hours_ago: synthesisAgeH === null ? null : Math.round(synthesisAgeH), stale: synthesisAgeH !== null && synthesisAgeH > 30, since_prepared: sincePrepared } }
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
      // Lo que el equipo busca o definió (contexto, NO evidencia) y la foto del comienzo (para decir qué cambió).
      declared_context: (((mission.watch ?? {}) as { declared?: { text: string }[] }).declared ?? []).map((d) => d.text),
      at_start: ((mission.watch ?? {}) as { initial?: unknown }).initial ?? null,
      watching_for: (((mission.watch ?? {}) as { criteria?: { text: string }[] }).criteria ?? []).map((c) => c.text),
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
    // Personas con mensaje preparado y relación vigente con una empresa que sigue la misión.
    outreach_ready: (drafts ?? []).flatMap((c) => {
      const link = c.contact_links.find((l) => !l.valid_until && l.companies && missionCompanies.has(l.companies.id));
      return link?.companies ? [{ ref: ref("contact", c.id), name: c.full_name, role: c.role_title, relationship: c.relationship_status, company: { ref: ref("company", link.companies.id), name: companyName(link.companies) } }] : [];
    }).slice(0, 40),
    follow_ups: {
      overdue: overdue.length,
      until_end_of_mission: (tasks ?? []).length,
      next: (tasks ?? []).slice(0, 15).map((x) => ({ ref: ref("task", x.id), title: clip(x.title, 160), due_on: x.due_on, channel: x.channel, with: x.contacts?.full_name ?? null, company: x.campaign_targets?.companies ? { ref: ref("company", x.campaign_targets.companies.id), name: companyName(x.campaign_targets.companies) } : null })),
    },
    agenda: (plans ?? []).map((p) => ({ title: p.title, on: p.planned_on, stops: p.visit_stops[0]?.count ?? 0 })),
    aog_scripts: (aog ?? []).map((q) => ({ code: q.code, entity: q.industry?.replace(/^AOG\s*·\s*/, "") ?? null, topic: q.dimension, opening: clip(q.question, 300), next_action: q.next_action })),
    assets: (assets ?? []).map((x) => x.assets).map((a) => {
      const p = [...a.asset_prices].sort((x, y) => (y.observed_on ?? "").localeCompare(x.observed_on ?? ""))[0];
      return { ref: ref("asset", a.id), title: a.title, category: a.category, locality: a.locality, last_price: a.price_status === "inconsistente" ? null : p ? `${p.currency} ${Number(p.amount).toLocaleString("es-AR")}${p.period ? `/${p.period}` : ""}` : null,
        // Dos fuentes que no coinciden: se muestran todas las cifras; RELEVO no elige cuál es la correcta.
        prices_in_conflict: a.price_status === "inconsistente" ? [...new Set(a.asset_prices.map((x) => `${x.currency} ${Number(x.amount).toLocaleString("es-AR")}`))] : undefined,
        prices_seen: a.asset_prices.length, price_status: a.price_status === "inconsistente" ? "PRECIO INCONSISTENTE — verificar" : a.price_status, located: a.latitude !== null };
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


/**
 * ¿Esta misión tiene Morning Brief? Es una capacidad de la misión, no de Vaca Muerta: se configura en
 * workspace.settings.brief.campaign_ids; si no está configurado, la primera misión (la que lo tuvo siempre).
 */
export async function isBriefMission(db: Db, missionId: string): Promise<boolean> {
  const { data: m } = await db.from("campaigns").select("workspace_id").eq("id", missionId).maybeSingle();
  if (!m) return false;
  const { data: ws } = await db.from("workspaces").select("settings").eq("id", m.workspace_id).single();
  const configured = (ws?.settings as { brief?: { campaign_ids?: string[] } } | null)?.brief?.campaign_ids;
  if (configured?.length) return configured.includes(missionId);
  const { data } = await db.from("campaigns").select("id").eq("workspace_id", m.workspace_id).eq("kind", "mision").order("created_at").limit(1).maybeSingle();
  return data?.id === missionId;
}
