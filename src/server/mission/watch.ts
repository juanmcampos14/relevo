import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { fetchGoogleNews } from "@/server/news/google-news";
import { normalize } from "@/domain/news";
import { SIGNAL_TYPES } from "@/domain/brief/contract";
import { companyName } from "@/server/entities";
import { configuredEmailProvider } from "@/server/email/provider";
import { deepCall } from "./deep";
import { ingestDiscovery, type Discovered } from "./ingest";
import { originalUrl } from "@/server/news/original-url";

// Vigilancia activa de cada misión: RELEVO no espera a que la persona entre. Durante el día:
// DETECTAR (noticias nuevas de las búsquedas de la misión y de sus actores) → CRUZAR con lo que la misión
// sigue → EVALUAR (¿cambia algo de lo que sabemos, creemos o seguimos?) → INCORPORAR (señal; actores claros
// entran solos, lo dudoso queda como pregunta) → AVISAR solo si cambia algo material. 200 notas que no cambian
// nada = silencio. Si no hay nada nuevo, no se llama a la IA.

type Db = SupabaseClient<Database>;
const PROMPT_VERSION = "mision-vigilancia-v2";
const MAX_ITEMS = 30;
const MAX_ALERTS_PER_DAY = 3;

export type WatchConfig = { queries?: string[]; sites?: string[]; region?: string | null; context?: string | null; criteria?: { text: string; at: string; by?: string | null }[] };
export type WatchMission = { id: string; workspace_id: string; slug: string; settings: unknown; name: string; objective: string | null; watch: WatchConfig | null };

const Ref = z.string();
export const WatchSchema = z.object({
  signals: z.array(z.object({
    item: z.number().int().describe("Número de la nota en la lista."),
    headline: z.string().describe("Qué pasó, en una oración, sin adjetivos."),
    matters: z.string().describe("Por qué importa PARA ESTA MISIÓN: qué cambia de lo que sabemos, creemos o seguimos (una oración)."),
    basis: z.enum(["hecho", "declaracion", "inferencia"]),
    change: z.enum(["nuevo", "actualizado", "confirmado", "contradicho"]),
    relevance: z.enum(["alta", "media", "baja"]),
    signal_type: z.enum(SIGNAL_TYPES),
    company_refs: z.array(Ref).describe("'company:…' de la memoria que toca."),
    finding_refs: z.array(Ref).describe("'finding:…' de la misión que fortalece o debilita."),
    asset_refs: z.array(Ref),
    action: z.string().describe("Qué haría, en una oración, o '' si nada."),
    alert: z.boolean().describe("true SOLO si cambia algo material (una hipótesis, un actor importante nuevo, un activo, o merece una acción ya) o si cumple un pedido de aviso de la persona. Casi siempre false."),
    matches_request: z.string().describe("Si cumple un pedido de aviso, cuál (en sus palabras); si no, ''."),
    discovered: z.array(z.object({
      kind: z.enum(["empresa", "persona", "activo"]),
      name: z.string().describe("Nombre que identifica (un activo: qué es y dónde, nunca la promesa del vendedor como renta o capacidad proyectada)."),
      detail: z.string().describe("Qué es y por qué importa, en una línea."),
      company: z.string().describe("Persona: empresa donde está (o ''). Activo: dónde está (o '')."),
      maybe: Ref.describe("'company:…' o 'contact:…' de la memoria si podría ser el mismo y no estás seguro; '' si no."),
    })).describe("Actores o activos que la memoria NO tiene y que importan para la misión."),
  })).describe("Solo las notas que cambian algo para la misión. Si ninguna cambia nada, lista vacía."),
});

const SYSTEM = `Sos el radar de RELEVO para una misión de investigación de oportunidades de negocio. Recibís notas nuevas y la memoria de la misión. Tu criterio es el producto: no sos un agregador.
Para cada nota preguntate: ¿esto cambia algo de lo que sabemos, creemos o estamos siguiendo? ¿crea o modifica una señal, un actor, una relación, una hipótesis, una oportunidad o una acción? Una nota grande de una operadora puede no cambiar nada; una chica donde aparece por primera vez una contratista puede cambiar mucho.
Devolvé solo las que cambian algo, o las que cumplen un pedido de aviso de la persona. Ruido = afuera. Nada de inventar: referencias solo de la memoria; actores nuevos solo si la nota los nombra.`;

async function missionMemory(db: Db, m: WatchMission) {
  const [{ data: findings }, { data: targets }, { data: recent }] = await Promise.all([
    db.from("findings").select("id, statement").eq("campaign_id", m.id).eq("case_status", "activo").neq("review_status", "rechazado").limit(60),
    db.from("campaign_targets").select("priority, companies(id, trade_name, legal_name), assets(id, title)").eq("campaign_id", m.id).neq("status", "descartado").limit(300),
    db.from("brief_signals").select("headline").contains("campaign_ids", [m.id]).gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString()).limit(60),
  ]);
  const companies = (targets ?? []).flatMap((t) => (t.companies ? [{ ref: `company:${t.companies.id}`, name: companyName(t.companies), priority: t.priority }] : []));
  const assets = (targets ?? []).flatMap((t) => (t.assets ? [{ ref: `asset:${t.assets.id}`, title: t.assets.title }] : []));
  return { findings: (findings ?? []).map((f) => ({ ref: `finding:${f.id}`, statement: f.statement })), companies, assets, recent: (recent ?? []).map((r) => r.headline) };
}

/** Qué buscar: lo que se configuró para la misión + sus actores más importantes. */
export function watchQueries(m: WatchMission, companies: { name: string; priority: number | null }[]): string[] {
  const base = m.watch?.queries?.length ? m.watch.queries : [m.name.split("—")[0].trim()];
  const actors = companies.filter((c) => c.priority === 1).slice(0, 6).map((c) => `"${c.name}"`);
  return [...new Set([...base, ...actors])].slice(0, 12);
}

export async function watchMission(db: Db, m: WatchMission, opts: { client?: Pick<Anthropic, "beta">; siteUrl?: string } = {}) {
  const memory = await missionMemory(db, m);
  const queries = watchQueries(m, memory.companies);
  const { data: seenRows } = await db.from("brief_source_items").select("url").eq("workspace_id", m.workspace_id).gte("seen_at", new Date(Date.now() - 60 * 86_400_000).toISOString());
  const seen = new Set((seenRows ?? []).map((r) => r.url));
  const titles = new Set<string>();
  const items: { url: string; title: string; publisher: string; publishedAt: string | null; snippet: string | null }[] = [];
  for (const q of queries) {
    try {
      for (const n of await fetchGoogleNews(q, 1)) {
        const t = normalize(n.title);
        if (seen.has(n.url) || titles.has(t)) continue;
        titles.add(t);
        items.push({ url: n.url, title: n.title, publisher: n.sourceName ?? "—", publishedAt: n.publishedAt, snippet: n.snippet });
      }
    } catch {
      /* una fuente caída no corta la vigilancia */
    }
  }
  const fresh = items.slice(0, MAX_ITEMS);
  if (!fresh.length) return { items: 0, signals: 0, alerts: 0, ingested: 0, costUsd: 0 };
  // Quedan vistas (no se vuelven a evaluar), las cambie o no.
  await db.from("brief_source_items").upsert(fresh.map((i) => ({ workspace_id: m.workspace_id, url: i.url, title: i.title.slice(0, 500), publisher: i.publisher, published_at: i.publishedAt })) as never, { onConflict: "workspace_id,url", ignoreDuplicates: true });

  const prompt = JSON.stringify({
    mision: { nombre: m.name, objetivo: m.objective, contexto: m.watch?.context ?? null, zona: m.watch?.region ?? null },
    pedidos_de_aviso: (m.watch?.criteria ?? []).map((c) => c.text),
    memoria: { hipotesis: memory.findings, empresas: memory.companies.map(({ ref, name }) => ({ ref, name })), activos: memory.assets, senales_recientes: memory.recent },
    notas: fresh.map((i, n) => ({ n, title: i.title, publisher: i.publisher, date: i.publishedAt, snippet: i.snippet })),
  });
  const r = await deepCall(db, { workspaceId: m.workspace_id, promptVersion: PROMPT_VERSION, system: SYSTEM, prompt, schema: WatchSchema, client: opts.client, effort: "low" });
  if (!r.ok) return { items: fresh.length, signals: 0, alerts: 0, ingested: 0, costUsd: 0, error: r.message };

  const allowed = new Set([...memory.findings.map((f) => f.ref), ...memory.companies.map((c) => c.ref), ...memory.assets.map((a) => a.ref)]);
  const ids = (refs: string[], type: string) => refs.filter((x) => x.startsWith(`${type}:`) && allowed.has(x)).map((x) => x.split(":")[1]);
  const today = new Date().toISOString().slice(0, 10);
  const { count: alertedToday } = await db.from("brief_signals").select("id", { count: "exact", head: true }).contains("campaign_ids", [m.id]).gte("alerted_at", `${today}T00:00:00Z`);
  let alerts = alertedToday ?? 0;
  const toAlert: { headline: string; matters: string; url: string }[] = [];
  const discovered: Discovered[] = [];
  let saved = 0;
  for (const s of r.value.signals) {
    const item = fresh[s.item];
    if (!item || (s.relevance === "baja" && !s.matches_request)) continue;
    // La fuente que se guarda y se manda es la nota del medio, no la redirección de Google Noticias.
    const url = await originalUrl(item.url);
    // Avisa lo material o lo que la persona pidió que le avisen (aunque no sea de relevancia alta).
    const alert = s.alert && (s.relevance === "alta" || !!s.matches_request) && alerts < MAX_ALERTS_PER_DAY;
    const { data: row, error } = await db.from("brief_signals").insert({
      workspace_id: m.workspace_id, brief_id: null, origin: "vigilancia", headline: s.headline.slice(0, 400), summary: item.snippet?.slice(0, 1000) ?? null,
      happened_on: item.publishedAt?.slice(0, 10) ?? null, source_url: /^https?:\/\//.test(url) ? url : null, source_title: item.title.slice(0, 300), publisher: item.publisher,
      basis: s.basis, signal_type: s.signal_type, section: "general", why_it_matters: s.matters, reading: s.matters, change: s.change, relevance: s.relevance,
      company_ids: ids(s.company_refs, "company"), finding_ids: ids(s.finding_refs, "finding"), asset_ids: ids(s.asset_refs, "asset"), campaign_ids: [m.id],
      suggested_action: s.action || null, alerted_at: alert ? new Date().toISOString() : null,
    } as never).select("id").single();
    if (error || !row) continue;
    saved++;
    if (alert) { alerts++; toAlert.push({ headline: s.headline, matters: s.matches_request ? `${s.matters} (Me pediste que te avise: ${s.matches_request}.)` : s.matters, url }); }
    for (const d of s.discovered) discovered.push({ ...d, maybe: d.maybe && allowed.has(d.maybe) ? d.maybe : "", source_url: url, source_title: item.title, signal_id: (row as { id: string }).id });
  }
  const ingest = discovered.length ? await ingestDiscovery(db, { workspaceId: m.workspace_id, missionId: m.id }, discovered) : { ingested: 0, questions: 0 };
  if (toAlert.length) await sendAlerts(m, toAlert, opts.siteUrl).catch(() => null);
  return { items: fresh.length, signals: saved, alerts: toAlert.length, ingested: ingest.ingested, questions: ingest.questions, costUsd: r.costUsd };
}

/** Avisar solo lo que cambia algo: un mail corto por cada señal material (además del aviso en Ahora). */
async function sendAlerts(m: WatchMission, alerts: { headline: string; matters: string; url: string }[], siteUrl?: string) {
  const provider = configuredEmailProvider();
  const recipients = ((m.settings as { brief?: { recipients?: { email: string; name?: string }[] } } | null)?.brief?.recipients ?? []).filter((r) => r.email);
  if (!provider || !recipients.length) return;
  const mission = m.name.split("—")[0].trim();
  const link = siteUrl ? `${siteUrl}/hoy/${m.slug}/explorar` : null;
  for (const a of alerts) for (const r of recipients) {
    await provider.send({
      to: r.email,
      subject: `Nueva señal relevante — ${mission}`,
      text: `${a.headline}\n\n${a.matters}\n\nFuente: ${a.url}${link ? `\n\nVer por qué importa: ${link}` : ""}`,
      html: `<p style="font:16px/1.5 -apple-system,Segoe UI,sans-serif"><strong>${esc(a.headline)}</strong></p><p style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#4A463F">${esc(a.matters)}</p><p style="font:14px/1.5 -apple-system,Segoe UI,sans-serif"><a href="${esc(a.url)}">Fuente</a>${link ? ` · <a href="${esc(link)}">Ver por qué importa</a>` : ""}</p>`,
      idempotencyKey: `alerta-${m.id}-${r.email}-${normalize(a.headline).slice(0, 60)}`,
    });
  }
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const watchJson = (w: WatchConfig) => w as unknown as Json;

/** "Avisame si aparece algo así": queda como pedido de aviso de la misión (y, si hace falta, búsquedas nuevas). */
export function addCriterion(w: WatchConfig | null, c: { text: string; queries?: string[]; by?: string | null }, now = new Date()): WatchConfig {
  const base = w ?? {};
  const criteria = [...(base.criteria ?? []).filter((x) => x.text.toLowerCase() !== c.text.toLowerCase()), { text: c.text.trim().slice(0, 300), at: now.toISOString(), by: c.by ?? null }].slice(-12);
  const queries = [...new Set([...(base.queries ?? []), ...(c.queries ?? []).map((q) => q.trim()).filter(Boolean)])].slice(0, 12);
  return { ...base, criteria, queries };
}
