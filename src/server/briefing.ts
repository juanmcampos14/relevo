import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { dealflowStage, findingKind } from "@/domain/catalogs";
import { entityHref, resolveTargetEntity, targetEntitySelect } from "./entities";

export type BriefingItem = { text: string; href?: string; meta?: string };
export type BriefingSection = { key: string; title: string; items: BriefingItem[]; empty: string };
export type BriefingContent = { generatedAt: string; sections: BriefingSection[]; note: string };

const fmt = (d: string) =>
  new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(d));

/**
 * Briefing armado SOLO con registros del workspace dentro del periodo (sin IA).
 * Cada ítem enlaza al registro que lo respalda. Sin actividad, lo dice.
 * El personal prioriza lo propio (tareas asignadas, acciones y hallazgos cargados
 * por el usuario) pero no oculta decisiones pendientes ni avances del workspace.
 */
export async function buildBriefing(
  supabase: SupabaseClient<Database>,
  opts: { slug: string; workspaceId: string; userId: string; scope: "conjunto" | "personal"; periodStart: Date; periodEnd: Date },
): Promise<BriefingContent> {
  const { slug, userId, scope } = opts;
  const from = opts.periodStart.toISOString();
  const to = opts.periodEnd.toISOString();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(opts.periodEnd);
  const in7 = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(
    new Date(opts.periodEnd.getTime() + 7 * 86_400_000),
  );
  const mine = scope === "personal";
  const base = `/w/${slug}`;

  const [visits, findings, opps, decided, pending, stageChanges, overdue, upcomingPlans, nextActions] = await Promise.all([
    (() => {
      let q = supabase.from("visits").select(`id, visited_at, created_by, campaign_targets(${targetEntitySelect})`).gte("visited_at", from).lte("visited_at", to).order("visited_at");
      if (mine) q = q.eq("created_by", userId);
      return q;
    })(),
    supabase.from("findings").select("id, kind, statement, review_status, reviewed_at, created_at, created_by").or(`created_at.gte.${from},reviewed_at.gte.${from}`).lte("created_at", to),
    supabase.from("opportunities").select("id, title, status, created_at").gte("created_at", from).lte("created_at", to),
    supabase.from("decisions").select("id, question, status, decided_at, opportunity_id").gte("decided_at", from).lte("decided_at", to),
    supabase.from("decisions").select("id, question, due_on, created_at, opportunity_id").eq("status", "requested").order("created_at"),
    supabase.from("audit_log").select("entity_id, changes, created_at").eq("entity_type", "opportunities").eq("action", "update").gte("created_at", from).lte("created_at", to),
    (() => {
      let q = supabase.from("tasks").select("id, title, due_on, assignee_id, opportunity_id").neq("status", "done").lt("due_on", today);
      if (mine) q = q.eq("assignee_id", userId);
      return q;
    })(),
    supabase.from("visit_plans").select("id, title, planned_on, owner_id").gte("planned_on", today).lte("planned_on", in7).order("planned_on"),
    (() => {
      let q = supabase
        .from("campaign_targets")
        .select(`id, next_action, next_action_due, owner_id, ${targetEntitySelect}`)
        .not("next_action", "is", null)
        .neq("status", "descartado")
        .lte("next_action_due", in7)
        .order("next_action_due");
      if (mine) q = q.eq("owner_id", userId);
      return q;
    })(),
  ]);

  const oppTitles = new Map<string, string>();
  const stageEvents = (stageChanges.data ?? []).filter((e) => (e.changes as Record<string, unknown>)?.stage);
  const ids = [...new Set(stageEvents.map((e) => e.entity_id).filter(Boolean))] as string[];
  if (ids.length) {
    const { data } = await supabase.from("opportunities").select("id, title").in("id", ids);
    data?.forEach((o) => oppTitles.set(o.id, o.title));
  }

  const findingRows = (findings.data ?? []).filter((f) => !mine || f.created_by === userId || f.review_status === "pendiente_revision");

  const sections: BriefingSection[] = [
    {
      key: "avances",
      title: "Qué cambió",
      empty: "Sin nuevos avances registrados en el periodo.",
      items: [
        ...(visits.data ?? []).map((v) => {
          const e = v.campaign_targets ? resolveTargetEntity(v.campaign_targets) : null;
          return { text: `Visita a ${e?.name ?? "objetivo"}`, href: `${base}/agenda/visita/${v.id}`, meta: fmt(v.visited_at) };
        }),
        ...findingRows
          .filter((f) => f.review_status === "aprobado" && f.reviewed_at && f.reviewed_at >= from)
          .map((f) => ({ text: `Hallazgo aprobado (${findingKind.label(f.kind)}): ${f.statement}`, href: `${base}/oportunidades?h=${f.id}#h-${f.id}`, meta: fmt(f.reviewed_at!) })),
        ...(opps.data ?? []).map((o) => ({ text: `Oportunidad candidata: ${o.title}`, href: `${base}/oportunidades/o/${o.id}`, meta: fmt(o.created_at) })),
        ...(decided.data ?? []).map((d) => ({
          text: `Decisión ${d.status === "approved" ? "aprobada" : d.status === "rejected" ? "rechazada" : "diferida"}: ${d.question}`,
          href: d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`,
          meta: fmt(d.decided_at!),
        })),
        ...stageEvents.map((e) => {
          const ch = (e.changes as Record<string, { a?: string }>).stage;
          return {
            text: `${oppTitles.get(e.entity_id!) ?? "Oportunidad"} pasó a ${dealflowStage.label(ch?.a ?? "")}`,
            href: `${base}/oportunidades/o/${e.entity_id}`,
            meta: fmt(e.created_at),
          };
        }),
      ],
    },
    {
      key: "revision",
      title: "Pendiente de revisión",
      empty: "No hay hallazgos pendientes de revisión.",
      items: findingRows
        .filter((f) => f.review_status === "pendiente_revision")
        .map((f) => ({ text: `${findingKind.label(f.kind)}: ${f.statement}`, href: `${base}/oportunidades?h=${f.id}#h-${f.id}`, meta: fmt(f.created_at) })),
    },
    {
      key: "decisiones",
      title: "Decisiones pendientes",
      empty: "No hay decisiones pendientes.",
      items: (pending.data ?? []).map((d) => ({
        text: d.question,
        href: d.opportunity_id ? `${base}/oportunidades/o/${d.opportunity_id}` : `${base}/oportunidades/decisiones`,
        meta: d.due_on ? `vence ${fmt(d.due_on)}` : `pedida ${fmt(d.created_at)}`,
      })),
    },
    {
      key: "bloqueos",
      title: "Vencido / bloqueado",
      empty: "No hay tareas vencidas.",
      items: (overdue.data ?? []).map((t) => ({
        text: `Tarea vencida: ${t.title}`,
        href: t.opportunity_id ? `${base}/oportunidades/o/${t.opportunity_id}` : base,
        meta: t.due_on ? fmt(t.due_on) : undefined,
      })),
    },
    {
      key: "proximos",
      title: "Próximos 7 días",
      empty: "Sin jornadas ni acciones agendadas para los próximos 7 días.",
      items: [
        ...(upcomingPlans.data ?? []).map((p) => ({ text: `Jornada: ${p.title}`, href: `${base}/agenda/${p.id}`, meta: fmt(p.planned_on) })),
        ...(nextActions.data ?? []).map((a) => {
          const e = resolveTargetEntity(a);
          return {
            text: `${e?.name ?? "Objetivo"}: ${a.next_action}`,
            href: e ? entityHref(slug, e.kind, e.id) : undefined,
            meta: a.next_action_due ? (a.next_action_due < today ? `vencida ${fmt(a.next_action_due)}` : fmt(a.next_action_due)) : undefined,
          };
        }),
      ],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    sections,
    note: "Armado automáticamente a partir de registros del workspace, sin IA. Solo incluye lo que está cargado en RELEVO OS; la ausencia de registros no implica ausencia de trabajo.",
  };
}
