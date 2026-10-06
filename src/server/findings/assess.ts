import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { ECONOMIC_KEYS, sanitizeEconomics } from "@/domain/economics";
import { BUYER_ROLE, DEMAND_SECTOR, EVIDENCE_LEVEL_KEYS, PURPOSE_KEYS, sanitizeDiscovery, type Purpose } from "@/domain/discovery";
import { costOf } from "@/server/ai/pricing";
import { budgetBlock } from "@/server/ai/budget";
import {
  DIMENSIONS,
  DIMENSION_KEYS,
  GAPS,
  deterministicGaps,
  gapsFromDimensions,
  metrics,
  orderGaps,
  sanitizeDimensions,
  type EvidenceLink,
  type Gap,
} from "@/domain/readiness";

type Db = SupabaseClient<Database>;
const MODEL = "claude-sonnet-5-5";
const PROMPT_VERSION = "finding-estado-v6";
const DAILY_LIMIT = 60; // evaluaciones de hipótesis por día (no cuenta la conversación)
const GAP_KEYS = Object.keys(GAPS) as [Gap, ...Gap[]];

export const AssessmentSchema = z.object({
  summary: z.string().describe("En 1-2 oraciones: en qué estado está esta hipótesis y qué la frena."),
  dimensions: z.array(
    z.object({
      key: z.enum(DIMENSION_KEYS),
      status: z.enum(["sabido", "creido", "contradicho", "falta"]),
      summary: z.string().describe("Qué se sabe o qué falta, en una oración concreta."),
      evidence_ids: z.array(z.string()).describe("ids de la evidencia listada que lo sostiene (o lo contradice)."),
    }),
  ),
  next_validations: z.array(
    z.object({
      title: z.string().describe("Acción de validación concreta con verbo: a quién, qué preguntar o comprobar."),
      why: z.string().describe("Qué incertidumbre reduce y por qué ahora."),
      gap: z.enum(GAP_KEYS),
      who: z.string().nullable().describe("Con quién (persona, rol o tipo de empresa), si se puede decir."),
    }),
  ).describe("Entre 1 y 3, de la más útil a la menos útil."),
  economics: z.array(
    z.object({
      variable: z.enum(ECONOMIC_KEYS),
      value: z.string().describe("El valor tal como surge: \"hasta $18.000 por comida\", \"unas 35 personas\"."),
      basis: z.enum(["observado", "declarado", "calculado", "estimado"]).describe("observado/declarado: sale de la evidencia citada. calculado: derivado de otros valores (con fórmula). estimado: supuesto razonable, no evidencia."),
      formula: z.string().nullable().describe("Solo si es calculado: \"35 personas × $18.000\"."),
      evidence_ids: z.array(z.string()),
    }),
  ).describe("Solo las variables económicas que la evidencia permite conocer o calcular. Lo que no está, no se inventa."),
  discovery: z.object({
    belief: z.string().describe("Qué creemos, en una oración simple, como lo diría el equipo."),
    why: z.string().describe("Por qué lo creemos: qué lo sostiene hoy (evidencia, señales o solo el diseño del equipo). Si es solo diseño, decilo."),
    evidence_level: z.enum(EVIDENCE_LEVEL_KEYS).describe("nula: solo diseño. baja: contexto externo o una sola declaración. media: varias declaraciones u observaciones relacionadas. alta: casos independientes vinculados y verificados."),
    evidence_summary: z.string().describe("Qué evidencia hay, en una oración: cuántos datos, de quién, de qué tipo (declarado, observado, publicado)."),
    evidence_refs: z.array(z.string()).describe("Referencias 'evidence:…' (vinculada o relacionada) que sostienen lo anterior."),
    signal_refs: z.array(z.string()).describe("Referencias 'signal:…' del contexto externo que importan."),
    question_refs: z.array(z.string()).describe("Referencias 'question:…' del diseño de investigación que conviene usar para validar."),
    who_can_help: z.array(
      z.object({
        ref: z.string().describe("Referencia 'contact:…' o 'company:…' de la lista. Preferí una persona si la hay."),
        purpose: z.enum(PURPOSE_KEYS).describe("Qué representa ese actor para la MISIÓN, no qué le vamos a preguntar acá. comprar_asociar: dueño u operador de un negocio, activo, alojamiento o servicio (podríamos comprarlo o asociarnos). vender_crear: quien compra, paga, asigna o decide del lado de la demanda (operadoras, contratistas, compradores corporativos, Compras/RRHH/Facilities). inteligencia: brokers, asesores, cámaras, medios, trabajadores o gente local que explica cómo funciona la zona."),
        why: z.string().describe("Por qué esta persona o empresa: qué puede validar."),
        ask: z.string().describe("Qué preguntarle, concreto."),
      }),
    ).describe("Hasta 5, de la más útil a la menos útil, solo de la lista de empresas y personas relacionadas."),
  }),
});

const SYSTEM = `Evaluás el estado de una hipótesis (finding) de un equipo que investiga oportunidades de negocio (la zona y el objetivo salen de la misión), a partir de la evidencia vinculada. Tu trabajo es decir qué sabemos, qué creemos, qué lo contradice y qué falta saber, y proponer la validación más útil. Una persona decide.

Estados por dimensión:
- sabido: respaldado por evidencia listada. Que alguien haya DECLARADO algo es un hecho que sabemos, aunque su contenido no esté verificado: formulalo como declaración ("Un encargado de una empresa declaró que mandan 8 camionetas por semana a Neuquén"), nunca como verdad general.
- creido: lo que se deduce o generaliza a partir de esa evidencia y todavía no está validado ("puede ser un problema de varias flotas").
- contradicho: hay evidencia en contra listada.
- falta: no hay información.

Reglas:
- Citá solo ids de la evidencia listada. No inventes datos, empresas ni cifras.
- Un solo caso no alcanza para generalizar: tenelo en cuenta.
- La contraevidencia pesa tanto como la evidencia a favor; si hay, las validaciones deben ayudar a resolverla.
- Un finding no es una oportunidad: no propongas avanzar comercialmente, proponé validar.
- Las validaciones son concretas y realizables en campo o por teléfono (a quién, qué preguntar, qué dato conseguir).
- Economía: registrá solo lo que la evidencia dice (declarado u observado, citando ids) o lo que se calcula de eso (con la fórmula). Una estimación se marca como estimada. No completes variables por completar.
- Discovery: investigamos para cerrar gaps. El diseño del equipo (contexto de la hipótesis y preguntas) NO es evidencia: es lo que creemos y cómo pensamos validarlo. La evidencia relacionada (sobre empresas vinculadas, no vinculada todavía a esta hipótesis) es real pero indirecta: usala con su procedencia. Las señales externas son contexto: no prueban demanda.
- "Quién puede ayudar": solo personas o empresas de las listas, con una pregunta concreta que cierre un gap. Si la lista trae el propósito ya definido, respetalo. Cubrí los dos lados cuando la hipótesis lo pida: quien ofrece/opera y quien compra, paga, asigna o decide (lado demanda). Si no hay nadie del lado demanda en las listas, decilo en why.
- Economía con procedencia: un dato publicado por la propia empresa (en su web, un aviso) o dicho por una persona es DECLARADO por ella, no estimado: citá su id de evidencia (vinculada o relacionada). Estimado es solo un supuesto tuyo sin evidencia. Publicado no significa verdadero: el nivel de validación queda en la evidencia.
- Precio distinto ≠ baja de precio. Dos precios para un mismo activo pueden ser otra publicación, otro broker, otro activo, un error, una actualización o un cambio real: no decidas cuál. Nunca infieras que algo "saldría más barato", que "bajó" o que hay margen de negociación; decí que el precio es inconsistente y que falta saber cuál es el vigente.
- No inventes actores. Si un propietario, broker u operador aparece solo como texto del activo (no como empresa o persona de las listas), no lo propongas como "quién puede ayudar": identificarlo es un faltante ("falta identificar propietario/broker").
- Español rioplatense, breve.`;

/** La evidencia relacionada se lista como "evidence:uuid"; la vinculada, por id. Se aceptan ambas formas. */
const bareId = (id: string) => id.replace(/^evidence:/, "");

export type AssessResult = { ok: true; assessmentId: string; proposals: number } | { ok: false; message: string };

export async function assessFinding(db: Db, opts: { workspaceId: string; settings: unknown; userId: string; findingId: string; client?: Anthropic; today?: string; background?: boolean }): Promise<AssessResult> {
  if ((opts.settings as { ai_processing_consent?: boolean } | null)?.ai_processing_consent !== true) {
    return { ok: false, message: "El workspace no habilitó el procesamiento con IA." };
  }
  if (!process.env.ANTHROPIC_API_KEY && !opts.client) return { ok: false, message: "La IA no está configurada en este entorno." };
  const blocked = await budgetBlock(opts.background ? "background" : "user");
  if (blocked) return { ok: false, message: blocked };
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("ai_runs").select("id", { count: "exact", head: true }).eq("user_id", opts.userId).like("prompt_version", "finding-estado%").gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, message: `Llegamos al tope de ${DAILY_LIMIT} evaluaciones de hipótesis en 24 horas.` };

  const { data: finding } = await db
    .from("findings")
    .select("id, statement, kind, analysis, companies(trade_name, legal_name), finding_evidence(stance, evidence(id, statement, quote, verification_status, origin_kind, observed_at, revalidate_after, company_id, stated_by_contact_id, capture_id, visit_id, source_id, about_unresolved_id, stated_by_unresolved_id, declared_by, companies(trade_name, legal_name), stated_by:contacts!evidence_workspace_id_stated_by_contact_id_fkey(full_name, role_title), about_u:unresolved_entities!evidence_about_unresolved_fk(label), said_u:unresolved_entities!evidence_stated_by_unresolved_fk(label)))")
    .eq("id", opts.findingId)
    .maybeSingle();
  if (!finding) return { ok: false, message: "Finding no encontrado." };

  const rows = finding.finding_evidence.filter((fe) => fe.evidence).map((fe) => ({ stance: fe.stance as EvidenceLink["stance"], e: fe.evidence! }));
  const links: EvidenceLink[] = rows.map(({ stance, e }) => ({ id: e.id, stance, verification_status: e.verification_status, revalidate_after: e.revalidate_after, company_id: e.company_id, stated_by_contact_id: e.stated_by_contact_id, capture_id: e.capture_id, visit_id: e.visit_id, source_id: e.source_id, about_unresolved_id: e.about_unresolved_id, stated_by_unresolved_id: e.stated_by_unresolved_id }));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const m = metrics(links, today);
  const detGaps = deterministicGaps(m);

  const ctxDiscovery = await discoveryContext(db, finding.id, new Set(links.map((l) => l.id)), opts.workspaceId);

  const evidenceText = rows.length
    ? rows.map(({ stance, e }) => [
        `- id ${e.id} · ${stance === "supports" ? "A FAVOR" : stance === "contradicts" ? "EN CONTRA" : "CONTEXTO"}`,
        `  "${e.statement}"${e.quote ? ` (cita: "${e.quote}")` : ""}`,
        `  verificación: ${e.verification_status} · origen: ${e.origin_kind}${e.observed_at ? ` · ${e.observed_at.slice(0, 10)}` : ""}`,
        `  empresa: ${e.companies?.trade_name ?? e.companies?.legal_name ?? (e.about_u ? `${e.about_u.label} (organización sin identificar)` : "—")} · dicho por: ${e.stated_by ? `${e.stated_by.full_name}${e.stated_by.role_title ? ` (${e.stated_by.role_title})` : ""}` : e.said_u ? `${e.said_u.label} (persona sin identificar)` : e.declared_by ? `${e.declared_by} (documento o cartel)` : "—"}`,
      ].join("\n")).join("\n")
    : "(no hay evidencia vinculada)";
  const prompt = [
    `FINDING: ${finding.statement}`,
    finding.analysis ? `Contexto: ${finding.analysis}` : null,
    finding.companies ? `Empresa: ${finding.companies.trade_name ?? finding.companies.legal_name}` : null,
    "",
    `MÉTRICAS (calculadas, no las cambies): ${m.supports} a favor · ${m.contradicts} en contra · ${m.independentCases} caso(s) independiente(s) · ${m.verified} verificada(s) · ${m.stale} desactualizada(s).`,
    `Faltantes ya detectados: ${detGaps.map((g) => GAPS[g].label).join(", ") || "ninguno"}.`,
    "",
    `DIMENSIONES A EVALUAR: ${DIMENSIONS.map((d) => `${d.key} (${d.label})`).join(", ")}.`,
    "",
    "EVIDENCIA VINCULADA:",
    evidenceText,
    "",
    ctxDiscovery.text,
  ].filter((x) => x !== null).join("\n");

  const started = Date.now();
  let parsed: z.infer<typeof AssessmentSchema> | null = null;
  let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let error: string | null = null;
  let status: "ok" | "error" | "refused" = "ok";
  try {
    const client = opts.client ?? new Anthropic();
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(AssessmentSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    usage = { input: res.usage.input_tokens ?? 0, output: res.usage.output_tokens ?? 0, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 };
    if (res.stop_reason === "refusal") {
      status = "refused";
      error = "El modelo no evaluó este finding.";
    } else if (!res.parsed_output) {
      status = "error";
      error = "La respuesta llegó incompleta.";
    } else parsed = res.parsed_output;
  } catch (e) {
    status = "error";
    error = e instanceof Anthropic.RateLimitError ? "Límite de uso del proveedor de IA: reintentá en unos minutos." : e instanceof Anthropic.APIError ? `Error del proveedor de IA (${e.status}).` : "No se pudo evaluar el finding.";
  }

  const cost = costOf(MODEL, usage);
  const { data: run } = await db
    .from("ai_runs")
    .insert({ workspace_id: opts.workspaceId, user_id: opts.userId, model: MODEL, prompt_version: PROMPT_VERSION, status, input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, cost_usd: Number(cost.toFixed(5)), error, duration_ms: Date.now() - started })
    .select("id")
    .single();
  if (!parsed) return { ok: false, message: error ?? "No se pudo evaluar el finding." };

  const dims = sanitizeDimensions(parsed.dimensions.map((d) => ({ ...d, evidence_ids: d.evidence_ids.map(bareId) })), links);
  const gaps = orderGaps([...detGaps, ...gapsFromDimensions(dims)]);
  const { data: assessment, error: e1 } = await db
    .from("finding_assessments")
    .insert({
      workspace_id: opts.workspaceId,
      finding_id: finding.id,
      evidence_ids: links.map((l) => l.id),
      dimensions: dims as unknown as NonNullable<Json>,
      // Economía: vale citar evidencia vinculada o relacionada (lo declarado por una empresa sobre sí misma).
      economics: sanitizeEconomics((parsed.economics ?? []).map((e) => ({ ...e, evidence_ids: e.evidence_ids.map(bareId) })), new Set([...links.map((l) => l.id), ...ctxDiscovery.relatedIds])) as unknown as NonNullable<Json>,
      gaps,
      summary: parsed.summary,
      discovery: sanitizeDiscovery(parsed.discovery, ctxDiscovery.seen) as unknown as Json,
      supports: m.supports,
      contradicts: m.contradicts,
      independent_cases: m.independentCases,
      ai_run_id: run?.id ?? null,
    })
    .select("id")
    .single();
  if (e1) return { ok: false, message: e1.message };

  // Las validaciones anteriores sin decidir se reemplazan; las ya decididas quedan en el historial.
  await db.from("proposals").delete().eq("finding_id", finding.id).eq("status", "propuesta");
  const order = (g: Gap) => (gaps.includes(g) ? gaps.indexOf(g) : 99);
  const validations = [...parsed.next_validations].sort((a, b) => order(a.gap) - order(b.gap)).slice(0, 3);
  if (validations.length) {
    const { error: e2 } = await db.from("proposals").insert(
      validations.map((v, i) => ({
        workspace_id: opts.workspaceId,
        finding_id: finding.id,
        assessment_id: assessment.id,
        kind: "next_action",
        position: i,
        payload: { title: v.title, why: v.why, gap: v.gap, who: v.who } as NonNullable<Json>,
        ai_run_id: run?.id ?? null,
      })),
    );
    if (e2) return { ok: false, message: e2.message };
  }
  return { ok: true, assessmentId: assessment.id, proposals: validations.length };
}

/**
 * Lo que rodea a una hipótesis en el Brain, para el discovery: empresas vinculadas y su gente, evidencia
 * sobre esas empresas (no vinculada todavía), preguntas del diseño de investigación y señales externas.
 */
async function discoveryContext(db: Db, findingId: string, linked: Set<string>, workspaceId: string) {
  const { data: fa } = await db.from("findings").select("assets(id, title, kind, operation, locality, surface_m2, capacity_text, occupancy_declared, owner_text, broker_text, operator_text, price_status, asset_prices(amount, currency, operation, observed_on, source_url, publisher, basis, note))").eq("id", findingId).maybeSingle();
  const [{ data: fc }, { data: qf }, { data: sig }] = await Promise.all([
    db.from("finding_companies").select("companies(id, trade_name, legal_name, sector, activity, locality, contact_links(contacts(id, full_name, role_title, contact_kind, relationship_status, outreach_draft)))").eq("finding_id", findingId).is("companies.contact_links.valid_until", null),
    db.from("question_findings").select("research_questions(id, code, kind, industry, dimension, question)").eq("finding_id", findingId),
    db.from("brief_signals").select("id, headline, basis, happened_on, publisher, origin").contains("finding_ids", [findingId]).order("happened_on", { ascending: false }).limit(10),
  ]);
  const companies = (fc ?? []).flatMap((x) => (x.companies ? [x.companies] : []));
  const companyIds = companies.map((c) => c.id);
  const { data: ev } = companyIds.length
    ? await db.from("evidence").select("id, statement, origin_kind, verification_status, declared_by, observed_at, company_id").in("company_id", companyIds).order("observed_at", { ascending: false }).limit(40)
    : { data: [] };
  const related = (ev ?? []).filter((e) => !linked.has(e.id));
  const people = new Map<string, string>();
  const purposes = new Map<string, Purpose>();
  // Propósito ya definido en los objetivos de la misión activa (lo que el actor representa para la misión).
  const { data: mission } = await db.from("campaigns").select("id").eq("workspace_id", workspaceId).eq("kind", "mision").eq("status", "activa").limit(1).maybeSingle();
  const { data: tg } = mission ? await db.from("campaign_targets").select("company_id, purpose").eq("campaign_id", mission.id).not("purpose", "is", null) : { data: [] };
  const companyPurpose = new Map((tg ?? []).map((x) => [x.company_id!, x.purpose as Purpose]));
  const lines: string[] = [];
  const asset = fa?.assets;
  if (asset) {
    lines.push(`ACTIVO DE LA HIPÓTESIS: ${asset.title} · ${[asset.kind, asset.operation, asset.locality].filter(Boolean).join(" · ")}${asset.surface_m2 ? ` · ${asset.surface_m2} m²` : ""}${asset.capacity_text ? ` · ${asset.capacity_text}` : ""}`);
    lines.push(`  Ocupación declarada: ${asset.occupancy_declared ?? "—"} · estado del precio: ${asset.price_status === "inconsistente" ? "INCONSISTENTE (no es una baja)" : asset.price_status ?? "—"}`);
    lines.push(`  Propietario / broker / operador SOLO COMO TEXTO (no son entidades del Brain): ${[asset.owner_text, asset.broker_text, asset.operator_text].filter(Boolean).join(" · ") || "sin datos"}`);
    for (const p of asset.asset_prices) lines.push(`  - precio ${p.currency} ${Number(p.amount).toLocaleString("es-AR")} · ${p.operation} · ${p.observed_on ?? "fecha s/d"} · ${p.publisher ?? p.source_url ?? "fuente s/d"} · ${p.basis}${p.note ? ` · ${p.note}` : ""}`);
    lines.push("");
  }
  lines.push("EMPRESAS Y PERSONAS RELACIONADAS (vinculadas a la hipótesis en el diseño):");
  for (const c of companies) {
    const name = c.trade_name ?? c.legal_name ?? "Empresa";
    people.set(`company:${c.id}`, name);
    const cp = companyPurpose.get(c.id);
    if (cp) purposes.set(`company:${c.id}`, cp);
    lines.push(`- company:${c.id} · ${name} · ${[c.sector, c.activity, c.locality].filter(Boolean).join(" · ")}${cp ? ` · propósito para la misión: ${cp}` : ""}`);
    for (const l of c.contact_links) {
      const p = l.contacts;
      if (!p) continue;
      people.set(`contact:${p.id}`, `${p.full_name} · ${name}`);
      if (cp) purposes.set(`contact:${p.id}`, cp);
      lines.push(`  - contact:${p.id} · ${p.full_name}${p.role_title ? ` (${p.role_title})` : ""} · ${p.contact_kind === "canal_institucional" ? "canal institucional" : "persona"} · relación: ${p.relationship_status ?? "—"}${p.outreach_draft ? " · tiene borrador de primer contacto" : ""}`);
    }
  }
  if (!companies.length) lines.push("(ninguna)");

  // Lado demanda: quienes compran, pagan, asignan o deciden, aunque no estén vinculados a esta hipótesis.
  const linkedCompanies = new Set(companies.map((c) => c.id));
  const { data: demand } = await db.from("companies").select("id, trade_name, legal_name, sector, activity, contact_links(contacts(id, full_name, role_title))").eq("workspace_id", workspaceId).eq("is_demo", false).is("contact_links.valid_until", null).limit(400);
  const buyers = (demand ?? [])
    .filter((c) => !linkedCompanies.has(c.id))
    .map((c) => ({ c, roles: c.contact_links.flatMap((l) => (l.contacts && BUYER_ROLE.test(l.contacts.role_title ?? "") ? [l.contacts] : [])) }))
    .filter(({ c, roles }) => DEMAND_SECTOR.test(`${c.sector ?? ""} ${c.activity ?? ""}`) || roles.length)
    .sort((a, b) => b.roles.length - a.roles.length)
    .slice(0, 15);
  lines.push("", "LADO DEMANDA (quienes compran, pagan, asignan o deciden; no vinculados todavía a esta hipótesis):");
  for (const { c, roles } of buyers) {
    const name = c.trade_name ?? c.legal_name ?? "Empresa";
    people.set(`company:${c.id}`, name);
    const cp = companyPurpose.get(c.id);
    if (cp) purposes.set(`company:${c.id}`, cp);
    lines.push(`- company:${c.id} · ${name} · ${[c.sector, c.activity].filter(Boolean).join(" · ")}${cp ? ` · propósito para la misión: ${cp}` : ""}`);
    for (const p of roles) {
      people.set(`contact:${p.id}`, `${p.full_name} · ${name}`);
      if (cp) purposes.set(`contact:${p.id}`, cp);
      lines.push(`  - contact:${p.id} · ${p.full_name}${p.role_title ? ` (${p.role_title})` : ""}`);
    }
  }
  if (!buyers.length) lines.push("(ninguno en el Brain)");
  lines.push("", "EVIDENCIA RELACIONADA (sobre esas empresas; no vinculada todavía a la hipótesis):");
  lines.push(...(related.length ? related.map((e) => `- evidence:${e.id} · "${e.statement}" · ${e.origin_kind} · ${e.verification_status}${e.declared_by ? ` · declarado por ${e.declared_by}` : ""}${e.observed_at ? ` · ${e.observed_at.slice(0, 10)}` : ""}`) : ["(ninguna)"]));
  const questions = (qf ?? []).flatMap((x) => (x.research_questions ? [x.research_questions] : []));
  lines.push("", "PREGUNTAS DEL DISEÑO DE INVESTIGACIÓN:");
  lines.push(...(questions.length ? questions.map((q) => `- question:${q.id} · ${q.code ?? ""} · ${q.kind}${q.industry ? ` · ${q.industry}` : ""}${q.dimension ? ` · ${q.dimension}` : ""} · ${q.question}`) : ["(ninguna)"]));
  lines.push("", "SEÑALES EXTERNAS (Morning Brief / Radar; contexto, no evidencia de demanda):");
  lines.push(...((sig ?? []).length ? sig!.map((x) => `- signal:${x.id} · ${x.happened_on ?? "s/f"} · ${x.basis} · ${x.headline}${x.publisher ? ` (${x.publisher})` : ""}`) : ["(ninguna)"]));
  return {
    text: lines.join("\n"),
    seen: {
      evidence: new Set([...linked].map((id) => `evidence:${id}`).concat(related.map((e) => `evidence:${e.id}`))),
      signals: new Set((sig ?? []).map((x) => `signal:${x.id}`)),
      questions: new Set(questions.map((q) => `question:${q.id}`)),
      people,
      purposes,
    },
    relatedIds: related.map((e) => e.id),
  };
}
