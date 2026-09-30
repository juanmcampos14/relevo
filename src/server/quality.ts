import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Dimension, Gap } from "@/domain/readiness";
import type { EconomicFact } from "@/domain/economics";
import { normalizeName } from "@/domain/crm-import/dedupe";
import { companyName } from "@/server/entities";

// Controles de calidad: alarmas para que la memoria no se degrade (no son métricas de actividad).
// Cada control dice qué está mal, cuántos casos y cuáles, con enlace para arreglarlo.

type Db = SupabaseClient<Database>;
export type QualityItem = { ref: string; label: string; href: string };
export type QualityCheck = { code: string; label: string; why: string; items: QualityItem[] };

export async function qualityChecks(db: Db, slug: string, today: string): Promise<QualityCheck[]> {
  const base = `/w/${slug}`;
  const [contacts, tasks, sources, companies, evidence, targets, opps, findings, dupCaptures] = await Promise.all([
    db.from("contacts").select("id, full_name, contact_kind, contact_links(id)").eq("contact_kind", "persona").limit(2000),
    db.from("tasks").select("id, title, target_id, contact_id, finding_id, opportunity_id").neq("status", "done").limit(2000),
    db.from("sources").select("id, title, url, kind").is("url", null).in("kind", ["url", "documento", "research_externo", "drive"]).limit(500),
    db.from("companies").select("id, trade_name, legal_name, source_id, evidence(id)").limit(2000),
    db.from("evidence").select("id, statement, revalidate_after, verification_status, company_id, asset_id, capture_id").lt("revalidate_after", today).neq("verification_status", "stale").limit(500),
    db.from("campaign_targets").select("id, priority, owner_id, next_action, status, companies(id, trade_name, legal_name), establishments(id, name), assets(id, title)").eq("priority", 1).neq("status", "descartado").limit(1000),
    db.from("opportunities").select("id, title, status, opportunity_findings(finding_id)").neq("status", "rechazada").limit(200),
    db.from("findings").select("id, statement, maturity, case_status, finding_assessments(created_at, gaps, dimensions, economics), tasks(id, status), proposals(id, status)").eq("review_status", "aprobado").neq("case_status", "descartado").limit(500),
    db.from("captures").select("id, captured_at").eq("status", "duplicado").limit(100),
  ]);
  const latest = (f: NonNullable<typeof findings.data>[number]) => [...f.finding_assessments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const targetLabel = (t: NonNullable<typeof targets.data>[number]) => (t.companies ? companyName(t.companies) : t.establishments?.name ?? t.assets?.title ?? "objetivo");
  const targetHref = (t: NonNullable<typeof targets.data>[number]) =>
    t.companies ? `${base}/e/company/${t.companies.id}` : t.establishments ? `${base}/e/establishment/${t.establishments.id}` : t.assets ? `${base}/e/asset/${t.assets.id}` : `${base}/explorar`;

  const byFinding = new Map((findings.data ?? []).map((f) => [f.id, f]));
  const buyerKnown = (id: string) => ((latest(byFinding.get(id)!)?.dimensions ?? []) as unknown as Dimension[]).some((d) => (d.key === "comprador" || d.key === "decisor") && d.status === "sabido");
  const econKnown = (id: string) => ((latest(byFinding.get(id)!)?.economics ?? []) as unknown as EconomicFact[]).some((e) => e.basis !== "estimado");
  const oppItems = (pred: (findingIds: string[]) => boolean) =>
    (opps.data ?? [])
      .filter((o) => pred(o.opportunity_findings.map((x) => x.finding_id).filter((id) => byFinding.has(id))))
      .map((o) => ({ ref: `opportunity:${o.id}`, label: o.title, href: `${base}/oportunidades/o/${o.id}` }));

  const names = new Map<string, NonNullable<typeof companies.data>[number][]>();
  for (const c of companies.data ?? []) {
    const k = normalizeName(companyName(c));
    if (k) names.set(k, [...(names.get(k) ?? []), c]);
  }

  const checks: QualityCheck[] = [
    { code: "contacto_sin_empresa", label: "Personas sin empresa", why: "No se sabe con quién está: no suma al mapa de compradores.", items: (contacts.data ?? []).filter((c) => !c.contact_links.length).map((c) => ({ ref: `contact:${c.id}`, label: c.full_name, href: `${base}/explorar/personas/${c.id}` })) },
    { code: "actividad_sin_entidad", label: "Actividades sin entidad", why: "Una acción que no está atada a nadie se pierde.", items: (tasks.data ?? []).filter((t) => !t.target_id && !t.contact_id && !t.finding_id && !t.opportunity_id).map((t) => ({ ref: `task:${t.id}`, label: t.title, href: `${base}/explorar/actividades` })) },
    { code: "fuente_sin_url", label: "Fuentes externas sin URL", why: "No se puede volver a la fuente original.", items: (sources.data ?? []).map((s) => ({ ref: `source:${s.id}`, label: s.title, href: `${base}/explorar/fuentes` })) },
    { code: "empresa_sin_fuente", label: "Empresas sin fuente ni evidencia", why: "No sabemos de dónde salió.", items: (companies.data ?? []).filter((c) => !c.source_id && !c.evidence.length).map((c) => ({ ref: `company:${c.id}`, label: companyName(c), href: `${base}/e/company/${c.id}` })) },
    { code: "evidencia_vencida", label: "Evidencia para revalidar", why: "Pasó su fecha de revalidación: puede estar desactualizada.", items: (evidence.data ?? []).map((e) => ({ ref: `evidence:${e.id}`, label: e.statement, href: e.capture_id ? `${base}/capturas/${e.capture_id}` : e.company_id ? `${base}/e/company/${e.company_id}` : `${base}/explorar/evidencia` })) },
    { code: "prioridad_sin_responsable", label: "Prioridad alta sin responsable", why: "Nadie se ocupa.", items: (targets.data ?? []).filter((t) => !t.owner_id).map((t) => ({ ref: `target:${t.id}`, label: targetLabel(t), href: targetHref(t) })) },
    { code: "prioridad_sin_proxima_accion", label: "Prioridad alta sin próxima acción", why: "No hay un paso concreto.", items: (targets.data ?? []).filter((t) => !t.next_action).map((t) => ({ ref: `target:${t.id}`, label: targetLabel(t), href: targetHref(t) })) },
    { code: "oportunidad_sin_comprador", label: "Oportunidades sin comprador identificado", why: "Una oportunidad necesita comprador o decisor.", items: oppItems((ids) => !ids.some(buyerKnown)) },
    { code: "oportunidad_sin_economia", label: "Oportunidades sin economía", why: "Una oportunidad necesita economía o mecanismo de valor.", items: oppItems((ids) => !ids.some(econKnown)) },
    {
      code: "caso_sin_hito", label: "Casos sin hito verificable", why: "Un caso sin próxima validación no avanza.",
      items: (findings.data ?? []).filter((f) => f.maturity === "caso" && f.case_status === "activo" && !f.tasks.some((t) => t.status !== "done") && !f.proposals.some((p) => p.status === "propuesta")).map((f) => ({ ref: `finding:${f.id}`, label: f.statement, href: `${base}/hallazgos/${f.id}` })),
    },
    {
      code: "contradiccion", label: "Contradicciones sin resolver", why: "Hay evidencia en contra que nadie resolvió.",
      items: (findings.data ?? []).filter((f) => ((latest(f)?.gaps ?? []) as Gap[]).includes("contradiccion_sin_resolver")).map((f) => ({ ref: `finding:${f.id}`, label: f.statement, href: `${base}/hallazgos/${f.id}` })),
    },
    {
      code: "posible_duplicado", label: "Posibles duplicados", why: "Dos registros para lo mismo parten la historia.",
      items: [
        ...[...names.values()].filter((g) => g.length > 1).map((g) => ({ ref: `company:${g[0].id}`, label: `${companyName(g[0])} (${g.length} registros)`, href: `${base}/explorar/registros?q=${encodeURIComponent(companyName(g[0]))}` })),
        ...(dupCaptures.data ?? []).map((c) => ({ ref: `capture:${c.id}`, label: `Captura del ${new Date(c.captured_at).toLocaleDateString("es-AR")} igual a otra`, href: `${base}/capturas/${c.id}` })),
      ],
    },
  ];
  return checks;
}
