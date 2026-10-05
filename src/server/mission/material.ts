import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { assessmentChanged, enteredHorizon, type KnownEvent, type MaterialChange } from "@/domain/material";

// ¿Cambió algo material en la misión desde un momento? Una sola lectura para el pulso, la síntesis, Avanzar
// y "Desde tu última visita": si no hay nada, el trabajo de fondo no gasta y la Surface no inventa novedades.

type Db = SupabaseClient<Database>;
const clip = (s: string | null | undefined, n = 280) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

export type MaterialSince = { items: MaterialChange[]; any: boolean; counts: Record<MaterialChange["kind"], number> };

/**
 * Lo material desde `since`: señales materiales (no re-confirmaciones), aportes de personas (capturas,
 * evidencia), hipótesis nuevas o cuya evaluación cambió lo que creemos, oportunidades nuevas, acciones
 * hechas, agenda que entró en hoy/mañana y correcciones de la persona. `excludeUser` deja afuera lo propio.
 */
export async function materialSince(db: Db, o: { missionId: string; workspaceId: string; since: string; now?: Date; excludeUser?: string | null }): Promise<MaterialSince> {
  const now = o.now ?? new Date();
  const since = o.since;
  const [signals, caps, ev, created, assessed, opps, drafts, done, tasks, plans, mission] = await Promise.all([
    db.from("brief_signals").select("id, headline, why_it_matters, created_at, company_ids, finding_ids, asset_ids, event_id").contains("campaign_ids", [o.missionId]).eq("material", true).gt("created_at", since).order("created_at", { ascending: false }).limit(20),
    db.from("captures").select("id, ai_summary, captured_by, captured_at").eq("campaign_id", o.missionId).gt("captured_at", since).limit(20),
    db.from("evidence").select("id, statement, created_by, created_at, company_id, asset_id, contact_id").eq("campaign_id", o.missionId).gt("created_at", since).not("created_by", "is", null).limit(30),
    db.from("findings").select("id, statement, created_by, created_at").eq("campaign_id", o.missionId).neq("review_status", "rechazado").gt("created_at", since).limit(20),
    db.from("finding_assessments").select("id, finding_id, dimensions, gaps, supports, contradicts, summary, created_at, findings!inner(campaign_id, statement)").eq("findings.campaign_id", o.missionId).gt("created_at", since).order("created_at").limit(30),
    db.from("opportunities").select("id, title, created_by, created_at").eq("campaign_id", o.missionId).gt("created_at", since).limit(10),
    db.from("ai_action_drafts").select("id, rationale, decided_by, decided_at, after_state").eq("workspace_id", o.workspaceId).eq("status", "ejecutada").gt("decided_at", since).limit(20),
    db.from("tasks").select("id, title, assignee_id, completed_at").eq("campaign_id", o.missionId).gt("completed_at", since).limit(20),
    db.from("tasks").select("id, title, due_on, assignee_id").eq("campaign_id", o.missionId).neq("status", "done").not("due_on", "is", null).limit(200),
    db.from("visit_plans").select("id, title, planned_on, owner_id").eq("campaign_id", o.missionId).limit(100),
    db.from("campaigns").select("synthesis").eq("id", o.missionId).maybeSingle(),
  ]);

  const items: MaterialChange[] = [];
  for (const s of signals.data ?? []) items.push({ kind: "senal", at: s.created_at, by: null, text: [s.headline, s.why_it_matters].filter(Boolean).join(" — "), refs: [...s.company_ids.map((x) => `company:${x}`), ...s.finding_ids.map((x) => `finding:${x}`), ...s.asset_ids.map((x) => `asset:${x}`)] });
  for (const c of caps.data ?? []) items.push({ kind: "aporte", at: c.captured_at, by: c.captured_by, text: clip(c.ai_summary) || "Una captura de campo", refs: [`capture:${c.id}`] });
  for (const e of ev.data ?? []) items.push({ kind: "aporte", at: e.created_at, by: e.created_by, text: clip(e.statement), refs: [e.company_id && `company:${e.company_id}`, e.asset_id && `asset:${e.asset_id}`, e.contact_id && `contact:${e.contact_id}`].filter((x): x is string => !!x) });
  for (const f of created.data ?? []) items.push({ kind: "hipotesis", at: f.created_at, by: f.created_by, text: `Nueva: ${clip(f.statement)}`, refs: [`finding:${f.id}`] });

  // Una re-evaluación solo es material si cambió lo que creemos respecto de la anterior.
  const rows = assessed.data ?? [];
  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.finding_id))];
    const { data: prev } = await db.from("finding_assessments").select("finding_id, dimensions, gaps, supports, contradicts, created_at").in("finding_id", ids).lte("created_at", since).order("created_at", { ascending: false });
    const last = new Map<string, (typeof rows)[number] | NonNullable<typeof prev>[number]>();
    for (const p of prev ?? []) if (!last.has(p.finding_id)) last.set(p.finding_id, p);
    for (const r of rows) {
      if (assessmentChanged(last.get(r.finding_id) ?? null, r)) items.push({ kind: "hipotesis", at: r.created_at, by: null, text: `${clip((r.findings as { statement: string }).statement, 160)}: ${clip(r.summary, 200)}`, refs: [`finding:${r.finding_id}`] });
      last.set(r.finding_id, r);
    }
  }
  for (const x of opps.data ?? []) items.push({ kind: "oportunidad", at: x.created_at, by: x.created_by, text: x.title, refs: [`opportunity:${x.id}`] });
  // Acciones aplicadas: las de esta misión (o sin misión, del workspace).
  for (const d of drafts.data ?? []) {
    const mission = (d.after_state as { mission_id?: string } | null)?.mission_id;
    if (mission && mission !== o.missionId) continue;
    items.push({ kind: "accion", at: d.decided_at!, by: d.decided_by, text: clip(d.rationale) || "Se aplicó una acción", refs: [] });
  }
  for (const t of done.data ?? []) items.push({ kind: "accion", at: t.completed_at!, by: t.assignee_id, text: `Hecho: ${t.title}`, refs: [`task:${t.id}`] });
  const sinceDate = new Date(since);
  for (const t of tasks.data ?? []) if (enteredHorizon(t.due_on!, sinceDate, now)) items.push({ kind: "agenda", at: now.toISOString(), by: null, text: `Se acerca: ${t.title} (${t.due_on})`, refs: [`task:${t.id}`] });
  for (const p of plans.data ?? []) if (enteredHorizon(p.planned_on, sinceDate, now)) items.push({ kind: "agenda", at: now.toISOString(), by: null, text: `Se acerca la visita: ${p.title} (${p.planned_on})`, refs: [`plan:${p.id}`] });
  // Lo que la persona corrigió en Ahora (las entradas del sistema, sin autor, no cuentan).
  const log = ((mission.data?.synthesis as { focus?: { log?: { at: string; by: string | null; item: string; what: string }[] } } | null)?.focus?.log ?? []);
  for (const l of log) if (l.at > since && l.by) items.push({ kind: "correccion", at: l.at, by: l.by, text: `«${l.item}» — ${l.what}`, refs: [] });

  const mine = o.excludeUser ? items.filter((x) => x.by !== o.excludeUser) : items;
  const counts = { senal: 0, aporte: 0, hipotesis: 0, oportunidad: 0, accion: 0, agenda: 0, correccion: 0 };
  for (const x of mine) counts[x.kind]++;
  mine.sort((a, b) => b.at.localeCompare(a.at));
  return { items: mine, any: mine.length > 0, counts };
}

/** Los hechos que la misión ya conoce (60 días): la señal canónica con el texto de todas sus fuentes. */
export async function knownEvents(db: Db, missionId: string, days = 60, opts: { exceptBrief?: string } = {}): Promise<KnownEvent[]> {
  let q = db
    .from("brief_signals")
    .select("id, event_id, headline, summary, happened_on, created_at, story_id, company_ids, asset_ids")
    .contains("campaign_ids", [missionId])
    .gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .order("created_at")
    .limit(400);
  // Un Brief que se reintenta no se compara contra lo que él mismo guardó en el intento anterior.
  if (opts.exceptBrief) q = q.or(`brief_id.is.null,brief_id.neq.${opts.exceptBrief}`);
  const { data } = await q;
  const events = new Map<string, KnownEvent>();
  for (const s of data ?? []) {
    const root = s.event_id ?? s.id;
    const text = `${s.headline} ${s.summary ?? ""}`;
    const ev = events.get(root);
    if (!ev) events.set(root, { id: root, headline: s.headline, summary: s.summary, happened_on: s.happened_on ?? s.created_at.slice(0, 10), story_id: s.story_id, text, company_ids: [...s.company_ids], asset_ids: [...s.asset_ids] });
    else {
      ev.text += ` ${text}`;
      ev.company_ids = [...new Set([...ev.company_ids, ...s.company_ids])];
      ev.asset_ids = [...new Set([...ev.asset_ids, ...s.asset_ids])];
    }
  }
  return [...events.values()];
}

/** El trabajo que no se hizo porque no cambió nada queda registrado (costo 0): así se miden los skips. */
export async function logSkip(db: Db, o: { workspaceId: string; promptVersion: string; reason: string }) {
  await db.from("ai_runs").insert({ workspace_id: o.workspaceId, user_id: null, model: "-", prompt_version: o.promptVersion, status: "skipped", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, error: o.reason, duration_ms: 0 });
}
