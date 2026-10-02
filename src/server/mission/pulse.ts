import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { assessFinding } from "@/server/findings/assess";
import { synthesizeMission } from "./synthesis";
import { describeMission } from "./state";
import { prepareMoves } from "./moves";

// Un solo cerebro: DETECTAR → ENTENDER → CRUZAR → GUARDAR → ACTUALIZAR → PRIORIZAR → ACTUAR. El Brief detecta
// y cruza; acá lo que detectó actualiza lo que creemos (re-evaluar las hipótesis que tocó) y lo que pasa
// durante el día (capturas, mensajes, investigaciones, señales) vuelve a priorizar. El Morning Brief es la
// foto de las 7; esto es el estado vivo.

type Db = SupabaseClient<Database>;
export type MissionRef = { id: string; workspace_id: string; slug: string; settings: unknown };

const MAX_REASSESS = 5;

/** Quién firma el trabajo automático (los límites diarios de IA son por persona): el owner del workspace. */
async function owner(db: Db, workspaceId: string): Promise<string | null> {
  const { data } = await db.from("memberships").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").limit(1).maybeSingle();
  return data?.user_id ?? null;
}

/** Las hipótesis que tocó una señal desde `since` se vuelven a evaluar (si no se evaluaron después). */
export async function reassessFromSignals(db: Db, m: MissionRef, since: string): Promise<{ reassessed: string[] }> {
  const { data: signals } = await db
    .from("brief_signals")
    .select("finding_ids, created_at")
    .in("relevance", ["alta", "media"])
    .in("change", ["nuevo", "actualizado", "confirmado", "contradicho"])
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  const touched = new Map<string, string>();
  for (const s of signals ?? []) for (const f of s.finding_ids) if (!touched.has(f)) touched.set(f, s.created_at);
  if (!touched.size) return { reassessed: [] };
  const { data: assessed } = await db.from("finding_assessments").select("finding_id, created_at").in("finding_id", [...touched.keys()]).order("created_at", { ascending: false });
  const last = new Map<string, string>();
  for (const a of assessed ?? []) if (!last.has(a.finding_id)) last.set(a.finding_id, a.created_at);
  const due = [...touched].filter(([f, at]) => !last.get(f) || last.get(f)! < at).map(([f]) => f).slice(0, MAX_REASSESS);
  const userId = await owner(db, m.workspace_id);
  if (!userId) return { reassessed: [] };
  const done: string[] = [];
  for (const findingId of due) {
    const r = await assessFinding(db, { workspaceId: m.workspace_id, settings: m.settings, userId, findingId }).catch(() => null);
    if (r?.ok) done.push(findingId);
  }
  return { reassessed: done };
}

/** ¿Pasó algo desde la última síntesis que cambie el presente? */
export async function changesSince(db: Db, missionId: string, since: string) {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [captures, actions, signals, assessments] = await Promise.all([
    count(db.from("captures").select("id", { count: "exact", head: true }).gt("captured_at", since)),
    count(db.from("ai_action_drafts").select("id", { count: "exact", head: true }).eq("status", "ejecutada").gt("decided_at", since)),
    count(db.from("brief_signals").select("id", { count: "exact", head: true }).in("relevance", ["alta", "media"]).gt("created_at", since)),
    count(db.from("finding_assessments").select("id", { count: "exact", head: true }).gt("created_at", since)),
  ]);
  const { data: c } = await db.from("campaigns").select("synthesis").eq("id", missionId).maybeSingle();
  const log = ((c?.synthesis as { focus?: { log?: { at: string }[] } } | null)?.focus?.log ?? []).filter((l) => l.at > since).length;
  return { captures, actions, signals, assessments, corrections: log, any: captures + actions + signals + assessments + log > 0 };
}

/**
 * Pulso: si algo cambió desde la última síntesis, RELEVO re-evalúa lo que tocaron las señales, re-prioriza,
 * actualiza el estado de la misión y prepara el Avanzar de lo nuevo. Si nada cambió, no gasta.
 */
export async function pulse(db: Db, m: MissionRef): Promise<{ ran: boolean; changes: Awaited<ReturnType<typeof changesSince>>; costUsd: number; reassessed: number }> {
  const { data: c } = await db.from("campaigns").select("synthesized_at").eq("id", m.id).maybeSingle();
  const since = c?.synthesized_at ?? new Date(Date.now() - 86_400_000).toISOString();
  const changes = await changesSince(db, m.id, since);
  if (!changes.any) return { ran: false, changes, costUsd: 0, reassessed: 0 };
  const { reassessed } = await reassessFromSignals(db, m, since);
  let cost = 0;
  const s = await synthesizeMission(db, { workspaceId: m.workspace_id, campaignId: m.id });
  if (s.ok) cost += s.costUsd;
  const e = await describeMission(db, { workspaceId: m.workspace_id, campaignId: m.id });
  if (e.ok) cost += e.costUsd;
  const p = await prepareMoves(db, { workspaceId: m.workspace_id, campaignId: m.id, slug: m.slug, settings: m.settings });
  cost += p.costUsd;
  return { ran: true, changes, costUsd: cost, reassessed: reassessed.length };
}
