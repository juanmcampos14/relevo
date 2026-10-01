import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { MAX, type BriefContent, type BriefDraft, type BriefSignalView } from "@/domain/brief/contract";
import { briefDateAR, briefPeriod, changesOf, matchCompanies, verticalRadar } from "@/domain/brief/derive";
import { renderBriefEmail } from "@/domain/brief/render";
import type { EmailProvider } from "@/server/email/provider";
import { collectItems, type CollectedItem } from "./collect";
import type { ResearchEngine, SynthesisEngine } from "./engines";
import { loadBriefMemory, memoryDigest, type BriefMemory } from "./memory";

// Morning Brief: máquina de estados por brief (un brief por workspace y día).
//   recolectando → investigando → sintetizando → generado → (envíos por destinatario)
// Cada paso corre en su propia invocación y es reintentable: si falla el email, el brief ya está
// guardado y solo se reintenta el envío; si falla un paso, se reintenta ese paso, no todo.

type Db = SupabaseClient<Database>;
type J = NonNullable<Json>;
export const BRIEF_VERSION = "brief-v1-2026-10-07";
const STEP_LEASE_MS = 8 * 60_000;
export const MAX_STEP_ATTEMPTS = 4;
const MAX_SEND_ATTEMPTS = 5;

export type BriefRecipient = { name: string; email: string };
export type BriefSettings = { enabled: boolean; recipients: BriefRecipient[]; monthlyCapUsd: number };
/** Tope mensual de IA del brief (USD). Alcanzado, el brief sale igual en modo reducido: sin investigación web. */
export const DEFAULT_MONTHLY_CAP_USD = 60;
export function briefSettings(settings: unknown): BriefSettings {
  const b = (settings as { brief?: Partial<BriefSettings> } | null)?.brief;
  const recipients = Array.isArray(b?.recipients) ? b.recipients.filter((r): r is BriefRecipient => !!r && typeof r.email === "string" && r.email.includes("@")) : [];
  const cap = typeof b?.monthlyCapUsd === "number" && b.monthlyCapUsd > 0 ? b.monthlyCapUsd : DEFAULT_MONTHLY_CAP_USD;
  return { enabled: b?.enabled === true, recipients, monthlyCapUsd: cap };
}

/** Costo de IA de los briefs del mes (por fecha del brief). */
export async function monthSpendUsd(db: Db, workspaceId: string, briefDate: string): Promise<number> {
  const month = briefDate.slice(0, 7);
  const { data } = await db.from("briefs").select("usage").eq("workspace_id", workspaceId).gte("brief_date", `${month}-01`).lte("brief_date", `${month}-31`);
  return (data ?? []).reduce((acc, b) => acc + Object.values((b.usage ?? {}) as Record<string, { costUsd?: number }>).reduce((a, u) => a + (u?.costUsd ?? 0), 0), 0);
}

export type Engines = { research: ResearchEngine; synthesis: SynthesisEngine; email: EmailProvider | null };
export type StepOutcome = { briefId: string; did: string; status: string; more: boolean; error?: string };

/** Crea (o devuelve) el brief del día. Idempotente por (workspace, fecha). */
export async function ensureTodayBrief(db: Db, workspaceId: string, now = new Date()): Promise<string> {
  const date = briefDateAR(now);
  const { data: existing } = await db.from("briefs").select("id").eq("workspace_id", workspaceId).eq("brief_date", date).maybeSingle();
  if (existing) return existing.id;
  const { data: last } = await db.from("briefs").select("generated_at").eq("workspace_id", workspaceId).eq("status", "generado").order("generated_at", { ascending: false }).limit(1).maybeSingle();
  const period = briefPeriod(now, last?.generated_at ? new Date(last.generated_at) : null);
  const { data, error } = await db
    .from("briefs")
    .upsert({ workspace_id: workspaceId, brief_date: date, period_start: period.start.toISOString(), period_end: period.end.toISOString(), version: BRIEF_VERSION }, { onConflict: "workspace_id,brief_date", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const { data: again } = await db.from("briefs").select("id").eq("workspace_id", workspaceId).eq("brief_date", date).single();
  return again!.id;
}

/** Reserva el brief para un paso (evita dos invocaciones sobre el mismo paso). */
async function claim(db: Db, briefId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STEP_LEASE_MS).toISOString();
  const { data } = await db
    .from("briefs")
    .update({ step_started_at: new Date().toISOString() })
    .eq("id", briefId)
    .or(`step_started_at.is.null,step_started_at.lt.${staleBefore}`)
    .select("id");
  return !!data?.length;
}

/** Ejecuta UN paso del brief. more = queda otro paso por correr (la ruta lo encadena). */
export async function advanceBrief(db: Db, briefId: string, engines: Engines, opts: { siteUrl: string }): Promise<StepOutcome> {
  const { data: b } = await db.from("briefs").select("*, workspaces(name, slug, settings)").eq("id", briefId).single();
  if (!b) return { briefId, did: "nada", status: "inexistente", more: false };
  const ws = b.workspaces as unknown as { name: string; slug: string; settings: unknown };

  if (b.status === "generado") {
    const sent = await deliverBrief(db, briefId, engines.email, { siteUrl: opts.siteUrl });
    return { briefId, did: `envíos: ${sent.sent} enviados, ${sent.failed} fallidos`, status: b.status, more: false, error: sent.failed ? sent.lastError ?? undefined : undefined };
  }
  if (b.status === "fallido" || b.attempts >= MAX_STEP_ATTEMPTS) return { briefId, did: "nada", status: b.status, more: false, error: b.error ?? "Demasiados intentos" };
  if (!(await claim(db, briefId))) return { briefId, did: "en curso en otra invocación", status: b.status, more: false };

  const period = { start: b.period_start, end: b.period_end };
  try {
    if (b.status === "recolectando") {
      const { items, errors } = await collectItems(db, b.workspace_id, { start: new Date(b.period_start), end: new Date(b.period_end) });
      await db.from("briefs").update({ collected: items as unknown as J, research: { collect_errors: errors } as unknown as J, status: "investigando", step_started_at: null, attempts: 0, error: null }).eq("id", briefId);
      return { briefId, did: `recolectadas ${items.length} notas`, status: "investigando", more: true };
    }
    const items = (b.collected ?? []) as unknown as CollectedItem[];
    const memory = await loadBriefMemory(db, b.workspace_id);
    const digest = memoryDigest(memory);
    if (b.status === "investigando") {
      const { monthlyCapUsd } = briefSettings(ws.settings);
      const spent = await monthSpendUsd(db, b.workspace_id, b.brief_date);
      if (spent >= monthlyCapUsd) {
        // Tope alcanzado: sin investigación web; la síntesis trabaja solo con las notas recolectadas.
        const memo = `MODO REDUCIDO: se alcanzó el tope mensual de IA (USD ${spent.toFixed(2)} de ${monthlyCapUsd}). Sin investigación web: usar solo las notas recolectadas y decirlo en quiet_day_note.\n\n${items.map((i) => `- ${i.publisher} · ${i.publishedAt ?? "s/f"} · ${i.title} · ${i.url}\n${(i.body ?? i.description ?? "").slice(0, 1500)}`).join("\n\n")}`;
        const research = { ...((b.research as object) ?? {}), memo, sources: items.map((i) => ({ url: i.url, title: i.title })), capped: { spent, cap: monthlyCapUsd } };
        await db.from("briefs").update({ research: research as unknown as J, status: "sintetizando", step_started_at: null, attempts: 0, error: null }).eq("id", briefId);
        return { briefId, did: `modo reducido (tope USD ${monthlyCapUsd})`, status: "sintetizando", more: true };
      }
      const r = await engines.research.research({ briefDate: b.brief_date, period, items, memory: digest });
      const research = { ...((b.research as object) ?? {}), memo: r.memo, sources: r.sources };
      await db.from("briefs").update({ research: research as unknown as J, engines: { research: r.engine } as unknown as J, usage: { research: r.usage } as unknown as J, status: "sintetizando", step_started_at: null, attempts: 0, error: null }).eq("id", briefId);
      return { briefId, did: `investigación lista (${r.sources.length} fuentes)`, status: "sintetizando", more: true };
    }
    if (b.status === "sintetizando") {
      const research = b.research as { memo?: string; sources?: { url: string; title: string }[] };
      const s = await engines.synthesis.synthesize({ briefDate: b.brief_date, period, memo: research.memo ?? "", items, memory: digest });
      const content = await saveDraft(db, { briefId, workspaceId: b.workspace_id, briefDate: b.brief_date, draft: s.draft, memory, items, sources: research.sources ?? [] });
      const usage: Record<string, { costUsd?: number; webSearches?: number }> = { ...((b.usage as Record<string, { costUsd?: number; webSearches?: number }>) ?? {}), synthesis: s.usage };
      const runCost = Object.values(usage).reduce((a, u) => a + (u?.costUsd ?? 0), 0);
      const isVmn = (u: string) => /vacamuertanews\.com/i.test(u);
      const { count: storyCount } = await db.from("brief_stories").select("id", { count: "exact", head: true }).eq("workspace_id", b.workspace_id).eq("last_brief_id", briefId);
      content.metrics = {
        mode: (b.research as { capped?: unknown })?.capped ? "reducido" : "completo",
        costUsd: runCost,
        monthCostUsd: (await monthSpendUsd(db, b.workspace_id, b.brief_date)) + (s.usage.costUsd ?? 0),
        monthlyCapUsd: briefSettings(ws.settings).monthlyCapUsd,
        collected: items.length,
        collectedVmn: items.filter((i) => i.priority === "vmn").length,
        sourcesCited: content.sources.length,
        sourcesCitedVmn: content.sources.filter((x) => isVmn(x.url)).length,
        webSearches: usage.research?.webSearches ?? 0,
        signals: content.signals.length,
        signalsVmn: content.signals.filter((x) => isVmn(x.source_url) || /vaca muerta news/i.test(x.publisher)).length,
        stories: storyCount ?? 0,
        watchlist: content.watchlist.length,
        candidates: content.candidates.length,
      };
      await db.from("briefs").update({
        content: content as unknown as J,
        engines: { ...((b.engines as object) ?? {}), synthesis: s.engine } as unknown as J,
        usage: usage as unknown as J,
        status: "generado", generated_at: new Date().toISOString(), step_started_at: null, attempts: 0, error: null,
      }).eq("id", briefId);
      const recipients = briefSettings(ws.settings).recipients;
      if (recipients.length) {
        await db.from("brief_deliveries").upsert(
          recipients.map((r) => ({ workspace_id: b.workspace_id, brief_id: briefId, recipient_email: r.email.trim().toLowerCase(), recipient_name: r.name || null })),
          { onConflict: "brief_id,recipient_email", ignoreDuplicates: true },
        );
      }
      return { briefId, did: `brief generado (${content.signals.length} señales)`, status: "generado", more: recipients.length > 0 };
    }
    return { briefId, did: "nada", status: b.status, more: false };
  } catch (e) {
    const message = (e as Error).message || "Error desconocido";
    const attempts = b.attempts + 1;
    await db.from("briefs").update({ error: `${b.status}: ${message}`, attempts, step_started_at: null, ...(attempts >= MAX_STEP_ATTEMPTS ? { status: "fallido" as const } : {}) }).eq("id", briefId);
    return { briefId, did: `falló ${b.status}`, status: b.status, more: false, error: message };
  }
}

/** Vuelve a intentar un brief fallido desde el paso en que quedó (sin repetir lo ya hecho). */
export async function retryBrief(db: Db, briefId: string) {
  const { data: b } = await db.from("briefs").select("status, error, research, content").eq("id", briefId).single();
  if (!b) return;
  const failedStep = b.status === "fallido" ? (b.error?.split(":")[0] as "recolectando" | "investigando" | "sintetizando" | undefined) ?? "recolectando" : b.status;
  await db.from("briefs").update({ status: failedStep, attempts: 0, error: null, step_started_at: null }).eq("id", briefId);
}

// ---------------------------------------------------------------------------------------------

type SaveInput = { briefId: string; workspaceId: string; briefDate: string; draft: BriefDraft; memory: BriefMemory; items: CollectedItem[]; sources: { url: string; title: string }[] };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const url = (s: string) => (/^https?:\/\//i.test(s.trim()) ? s.trim() : null);
const date = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** Guarda señales, historias y candidatos cruzados con la memoria, y devuelve el contenido a renderizar. */
export async function saveDraft(db: Db, input: SaveInput): Promise<BriefContent> {
  const { draft, memory, workspaceId, briefId, briefDate } = input;
  const valid = {
    company: new Set(memory.companies.map((c) => c.id)),
    finding: new Set(memory.findings.map((f) => f.id)),
    campaign: new Set(memory.campaigns.map((c) => c.id)),
    asset: new Set(memory.assets.map((a) => a.id)),
    story: new Set(memory.stories.map((s) => s.id)),
  };
  const only = (ids: string[], set: Set<string>) => [...new Set(ids.filter((i) => set.has(i)))];

  // Historias: actualizar las existentes, abrir las nuevas ("nueva:clave").
  const storyIds = new Map<string, string>();
  const storyTitle = new Map<string, string>();
  const refs = new Set([...draft.signals.map((s) => s.story_ref), ...draft.watchlist.map((w) => w.story_ref)].filter(Boolean));
  for (const ref of refs) {
    const st = draft.stories.find((x) => x.ref === ref);
    if (valid.story.has(ref)) {
      storyIds.set(ref, ref);
      const patch = { last_seen_on: briefDate, last_brief_id: briefId, updated_at: new Date().toISOString(), ...(st?.summary ? { summary: st.summary } : {}) };
      await db.from("brief_stories").update(patch).eq("id", ref).eq("workspace_id", workspaceId);
      storyTitle.set(ref, memory.stories.find((x) => x.id === ref)?.title ?? st?.title ?? "");
    } else if (ref.startsWith("nueva:")) {
      const title = st?.title || draft.signals.find((s) => s.story_ref === ref)?.headline || draft.watchlist.find((w) => w.story_ref === ref)?.title;
      if (!title) continue;
      const vertical = draft.signals.find((s) => s.story_ref === ref)?.vertical ?? null;
      const { data } = await db.from("brief_stories").insert({ workspace_id: workspaceId, title, summary: st?.summary || null, vertical, first_seen_on: briefDate, last_seen_on: briefDate, last_brief_id: briefId }).select("id").single();
      if (data) {
        storyIds.set(ref, data.id);
        storyTitle.set(ref, title);
      }
    }
  }
  for (const w of draft.watchlist) {
    const id = storyIds.get(w.story_ref);
    if (id) await db.from("brief_stories").update({ status: "watchlist", watch_reason: w.why || null }).eq("id", id).eq("workspace_id", workspaceId);
  }

  // Señales cruzadas con la memoria (ids del modelo verificados + coincidencia determinista de empresas).
  const signals: BriefSignalView[] = [];
  const draftSignals = draft.signals.slice(0, MAX.signals);
  for (const [position, s] of draftSignals.entries()) {
    const companyIds = [...new Set([...only(s.related_company_ids, valid.company), ...matchCompanies([s.headline, s.summary, ...s.companies], memory.companies)])];
    const findingIds = only(s.related_finding_ids, valid.finding);
    const storyId = storyIds.get(s.story_ref) ?? null;
    const { data, error } = await db
      .from("brief_signals")
      .insert({
        workspace_id: workspaceId, brief_id: briefId, story_id: storyId, position,
        headline: s.headline, summary: s.summary || null, happened_on: date(s.happened_on), source_url: url(s.source_url), source_title: s.source_title || null, publisher: s.publisher || null,
        basis: s.basis, signal_type: s.signal_type, section: s.section, geography: s.geography || null, vertical: s.vertical, subsector: s.subsector || null,
        roles: s.roles, companies: s.companies, people: s.people, why_it_matters: s.why_it_matters || null, reading: s.reading || null,
        change: s.change, relevance: s.relevance, company_ids: companyIds, finding_ids: findingIds,
        campaign_ids: only(s.related_campaign_ids, valid.campaign), asset_ids: only(s.related_asset_ids, valid.asset), suggested_action: s.suggested_action || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { related_company_ids: _c, related_finding_ids: _f, related_campaign_ids: _k, related_asset_ids: _a, story_ref: _s, ...rest } = s;
    signals.push({ ...rest, source_url: url(s.source_url) ?? "", id: data.id, story_id: storyId, story_title: storyId ? storyTitle.get(s.story_ref) ?? null : null, company_ids: companyIds, finding_ids: findingIds });
  }

  // Candidatos: nunca lo que ya está en el CRM ni lo ya propuesto (detectado ≠ validado).
  const { data: prev } = await db.from("brief_candidates").select("kind, name").eq("workspace_id", workspaceId);
  const known = new Set((prev ?? []).map((p) => `${p.kind}:${fold(p.name)}`));
  const companyNames = new Set(memory.companies.map((c) => fold(c.name)));
  const candidates: BriefContent["candidates"] = [];
  for (const c of draft.candidates.slice(0, MAX.candidates)) {
    const key = `${c.kind}:${fold(c.name)}`;
    if (!c.name.trim() || known.has(key)) continue;
    if (c.kind === "empresa" && (companyNames.has(fold(c.name)) || matchCompanies([c.name], memory.companies).length)) continue;
    known.add(key);
    const { data } = await db.from("brief_candidates").insert({ workspace_id: workspaceId, brief_id: briefId, kind: c.kind, name: c.name.trim(), detail: c.detail || null, source_url: url(c.source_url) }).select("id").single();
    if (data) candidates.push({ ...c, id: data.id });
  }

  // Notas consideradas: no vuelven a entrar como nuevas.
  if (input.items.length) {
    await db.from("brief_source_items").upsert(
      input.items.map((i) => ({ workspace_id: workspaceId, url: i.url, title: i.title, publisher: i.publisher, published_at: i.publishedAt, first_brief_id: briefId })),
      { onConflict: "workspace_id,url", ignoreDuplicates: true },
    );
  }

  // Watchlist con memoria: todo lo que sigue en observación, no solo lo de hoy.
  const { data: watch } = await db.from("brief_stories").select("id, title, watch_reason, first_seen_on").eq("workspace_id", workspaceId).eq("status", "watchlist").order("last_seen_on", { ascending: false }).limit(12);
  const watchlist = (watch ?? []).map((w) => ({ story_id: w.id, title: w.title, why: draft.watchlist.find((x) => storyIds.get(x.story_ref) === w.id)?.why || w.watch_reason || "", since: w.first_seen_on }));

  const usedUrls = new Set(signals.map((s) => s.source_url).filter(Boolean));
  const publisherOf = new Map(input.items.map((i) => [i.url, i.publisher]));
  const sources = [...new Map([...input.sources.filter((s) => usedUrls.has(s.url)), ...input.sources].map((s) => [s.url, s])).values()]
    .slice(0, 30)
    .map((s) => ({ url: s.url, title: s.title, publisher: publisherOf.get(s.url) ?? null }));

  return {
    headline_points: draft.headline_points.slice(0, MAX.headline),
    signals,
    connections: draft.connections.slice(0, MAX.connections).map((c) => ({ ...c, memory_refs: c.memory_refs.filter((r) => /^(company|finding|campaign|asset|contact):[0-9a-f-]{36}$/.test(r)) })),
    actions: draft.actions.slice(0, MAX.actions),
    field_questions: draft.field_questions.slice(0, MAX.questions),
    watchlist,
    candidates,
    vertical_radar: verticalRadar(signals, draft.field_questions),
    changes: changesOf(signals),
    sources,
    quiet_day_note: draft.quiet_day_note,
  };
}

/** Envía el brief ya guardado a cada destinatario pendiente o fallido (mismo objeto, mismo render). */
export async function deliverBrief(db: Db, briefId: string, provider: EmailProvider | null, opts: { siteUrl: string }) {
  const { data: b } = await db.from("briefs").select("id, brief_date, content, status, workspaces(name, slug)").eq("id", briefId).single();
  const out = { sent: 0, failed: 0, lastError: null as string | null };
  if (!b || b.status !== "generado") return out;
  const ws = b.workspaces as unknown as { name: string; slug: string };
  const { data: pending } = await db.from("brief_deliveries").select("id, recipient_email, attempts").eq("brief_id", briefId).in("status", ["pendiente", "fallido"]).lt("attempts", MAX_SEND_ATTEMPTS);
  if (!pending?.length) return out;
  const email = renderBriefEmail(b.content as unknown as BriefContent, { briefId, briefDate: b.brief_date, workspaceName: ws.name, url: `${opts.siteUrl}/w/${ws.slug}/brief/${briefId}` });
  for (const d of pending) {
    const now = new Date().toISOString();
    if (!provider) {
      out.failed++;
      out.lastError = "No hay proveedor de email configurado (RESEND_API_KEY / BRIEF_FROM_EMAIL).";
      await db.from("brief_deliveries").update({ status: "fallido", error: out.lastError, last_attempt_at: now }).eq("id", d.id);
      continue;
    }
    const r = await provider.send({ to: d.recipient_email, subject: email.subject, html: email.html, text: email.text, idempotencyKey: `brief-${briefId}-${d.recipient_email}` });
    if (r.ok) {
      out.sent++;
      await db.from("brief_deliveries").update({ status: "enviado", provider: provider.name, provider_message_id: r.messageId, error: null, attempts: d.attempts + 1, last_attempt_at: now, sent_at: now }).eq("id", d.id);
    } else {
      out.failed++;
      out.lastError = r.error;
      await db.from("brief_deliveries").update({ status: "fallido", provider: provider.name, error: r.error, attempts: d.attempts + (r.retryable ? 1 : MAX_SEND_ATTEMPTS), last_attempt_at: now }).eq("id", d.id);
    }
  }
  return out;
}
