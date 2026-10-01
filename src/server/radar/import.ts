import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { mapRadar, priceStatusOf } from "@/domain/radar/sheet";
import { matchCompanies } from "@/domain/brief/derive";
import { parseTab } from "@/server/crm-import/parse";

// RADAR DE MERCADO del Sheet → Radar de RELEVO. Reejecutable: señales por ID (RAD-xxx), activos por
// radar_ref, precios solo si son una observación nueva (nunca se pisa el historial). Mientras el Sheet
// siga alimentándose (transición), reimportar suma lo nuevo; lo que se edite en RELEVO no se pisa salvo
// los campos que el Sheet todavía gobierna (texto del hallazgo, estado, próxima acción).

type Db = SupabaseClient<Database>;
export type RadarReport = {
  dryRun: boolean;
  signals: { created: string[]; updated: string[] };
  assets: { created: string[]; updated: string[]; inconsistent: string[]; review: string[] };
  prices: { added: number; existing: number };
  conversations: { created: number; existing: number };
  hypothesesLinked: string[];
  seenUrls: number;
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(fold(s).split(" ").filter((w) => w.length >= 4 && !["complejo", "anelo", "departamentos", "publicado", "precio"].includes(w)));

export async function migrateRadar(db: Db, workspaceId: string, buffer: ArrayBuffer, opts: { dryRun: boolean }): Promise<RadarReport> {
  const plan = mapRadar(await parseTab(buffer, "RADAR DE MERCADO", "Hallazgo"));
  const r: RadarReport = { dryRun: opts.dryRun, signals: { created: [], updated: [] }, assets: { created: [], updated: [], inconsistent: [], review: [] }, prices: { added: 0, existing: 0 }, conversations: { created: 0, existing: 0 }, hypothesesLinked: [], seenUrls: 0 };
  const today = new Date().toISOString().slice(0, 10);

  // Fuente "RADAR del Sheet" (procedencia de lo migrado).
  let sourceId: string | null = null;
  const { data: src } = await db.from("sources").select("id").eq("workspace_id", workspaceId).eq("reference", "sheet:radar").maybeSingle();
  sourceId = src?.id ?? null;
  if (!sourceId && !opts.dryRun) {
    const { data, error } = await db.from("sources").insert({ workspace_id: workspaceId, kind: "crm", title: "RADAR DE MERCADO (CRM en Sheets, alimentado por el Morning Brief de ChatGPT)", reference: "sheet:radar", notes: "Migrado a RELEVO. Cada fila conserva su enlace original." }).select("id").single();
    if (error) throw error;
    sourceId = data.id;
  }

  // 1. Activos y su historial de precios.
  const { data: existingAssets } = await db.from("assets").select("id, radar_ref").eq("workspace_id", workspaceId).not("radar_ref", "is", null);
  const assetByRef = new Map((existingAssets ?? []).map((a) => [a.radar_ref!, a.id]));
  for (const a of plan.assets) {
    const fields = {
      title: a.title, kind: a.kind, operation: a.operation, category: a.category, locality: a.locality, capacity_text: a.capacityText,
      surface_m2: a.surfaceM2, land_m2: a.landM2, occupancy_declared: a.occupancy, owner_text: a.owner, broker_text: a.broker, operator_text: a.operator,
      sale_reason: a.saleReason, economics_note: a.economics, first_detected_on: a.firstDetectedOn, last_checked_on: a.lastCheckedOn,
      material_change: a.materialChange, evidence_layer: a.evidenceLayer,
    };
    if (a.materialChange?.startsWith("REVISAR")) r.assets.review.push(a.ref);
    let id = assetByRef.get(a.ref);
    if (id) {
      r.assets.updated.push(a.ref);
      if (!opts.dryRun) await db.from("assets").update(fields).eq("id", id);
    } else {
      r.assets.created.push(a.ref);
      if (!opts.dryRun) {
        const { data, error } = await db.from("assets").insert({ workspace_id: workspaceId, radar_ref: a.ref, verification_status: "unverified", source_id: sourceId, ...fields }).select("id").single();
        if (error) throw new Error(`${a.ref}: ${error.message}`);
        id = data.id;
        assetByRef.set(a.ref, id);
      }
    }
    const { data: history } = id ? await db.from("asset_prices").select("amount, currency, source_url, observed_on").eq("asset_id", id) : { data: [] };
    const hist = (history ?? []).map((h) => ({ ...h, amount: Number(h.amount) }));
    for (const p of a.prices) {
      const dup = hist.some((h) => h.amount === p.amount && h.currency === p.currency && (h.source_url ?? "") === (p.url ?? "") && (h.observed_on ?? "") === (p.observedOn ?? ""));
      if (dup) {
        r.prices.existing++;
        continue;
      }
      r.prices.added++;
      hist.push({ amount: p.amount, currency: p.currency, source_url: p.url, observed_on: p.observedOn });
      if (!opts.dryRun && id) {
        const { error } = await db.from("asset_prices").insert({ workspace_id: workspaceId, asset_id: id, amount: p.amount, currency: p.currency, operation: p.operation, period: p.period, observed_on: p.observedOn, source_url: p.url, basis: "publicado", note: p.note, origin: "radar_sheet", external_ref: a.ref });
        if (error) throw new Error(`${a.ref} precio: ${error.message}`);
      }
    }
    const status = a.priceStatus === "inconsistente" ? "inconsistente" : priceStatusOf(hist);
    if (status === "inconsistente") r.assets.inconsistent.push(a.ref);
    if (!opts.dryRun && id) await db.from("assets").update({ price_status: status }).eq("id", id);
  }

  // 2. Señales (todas las filas salvo los guiones de AOG), vinculadas a empresas y activos.
  const { data: companies } = await db.from("companies").select("id, trade_name, legal_name").eq("workspace_id", workspaceId).eq("is_demo", false);
  const pool = (companies ?? []).map((c) => ({ id: c.id, name: c.trade_name ?? c.legal_name ?? "" })).filter((c) => c.name);
  const { data: existingSignals } = await db.from("brief_signals").select("id, external_ref").eq("workspace_id", workspaceId).not("external_ref", "is", null);
  const signalByRef = new Map((existingSignals ?? []).map((s) => [s.external_ref!, s.id]));
  for (const s of plan.signals) {
    const assetId = assetByRef.get(s.ref);
    const row = {
      headline: s.headline, summary: s.summary, happened_on: s.happenedOn, source_url: s.url, source_title: s.topic, publisher: null,
      basis: s.basis, signal_type: s.signalType, section: s.section, geography: s.location, vertical: s.vertical,
      companies: s.entity && s.section !== "activos" ? [s.entity] : [], company_ids: matchCompanies([s.headline, s.entity ?? ""], pool),
      asset_ids: assetId ? [assetId] : [], reading: s.implication, implication: s.implication, validation_status: s.validation, next_action: s.nextAction,
    };
    const existing = signalByRef.get(s.ref);
    if (existing) {
      r.signals.updated.push(s.ref);
      if (!opts.dryRun) await db.from("brief_signals").update(row).eq("id", existing);
    } else {
      r.signals.created.push(s.ref);
      if (!opts.dryRun) {
        const { error } = await db.from("brief_signals").insert({ workspace_id: workspaceId, brief_id: null, origin: "radar_sheet", external_ref: s.ref, change: "nuevo", relevance: "media", position: 0, ...row });
        if (error) throw new Error(`${s.ref}: ${error.message}`);
      }
    }
  }

  // 3. Las URLs del Radar quedan como vistas: el Morning Brief no las vuelve a reportar como nuevas.
  const urls = [...new Set(plan.signals.map((s) => s.url).filter((u): u is string => !!u))];
  r.seenUrls = urls.length;
  if (!opts.dryRun && urls.length) {
    await db.from("brief_source_items").upsert(urls.map((url) => ({ workspace_id: workspaceId, url, title: "RADAR del Sheet", publisher: "CRM" })), { onConflict: "workspace_id,url", ignoreDuplicates: true });
  }

  // 4. Guiones de conversación AOG → preguntas de entrevista (borrador hasta cerrar la estrategia de AOG).
  const { data: qs } = await db.from("research_questions").select("code").eq("workspace_id", workspaceId).in("code", plan.conversations.map((c) => c.ref));
  const known = new Set((qs ?? []).map((q) => q.code));
  for (const c of plan.conversations) {
    if (known.has(c.ref)) {
      r.conversations.existing++;
      continue;
    }
    r.conversations.created++;
    if (!opts.dryRun) {
      const { error } = await db.from("research_questions").insert({ workspace_id: workspaceId, code: c.ref, kind: "entrevista", industry: `AOG · ${c.entity}`, dimension: c.topic, question: c.script || c.entity, next_action: c.nextAction, source_url: c.url, origin: "crm" });
      if (error) throw new Error(`${c.ref}: ${error.message}`);
    }
  }

  // 5. Hallazgos del CRM sobre activos (HAL-xxx) → el activo del Radar que describen.
  const { data: hal } = await db.from("findings").select("id, dedup_key, statement, asset_id").eq("workspace_id", workspaceId).like("dedup_key", "crm:HAL-%");
  for (const f of hal ?? []) {
    if (f.asset_id) continue;
    const fw = words(f.statement);
    const best = plan.assets
      .map((a) => ({ a, score: [...words(a.title)].filter((w) => fw.has(w)).length + (fw.has("inconsistente") && a.priceStatus === "inconsistente" ? 0.5 : 0) }))
      .sort((x, y) => y.score - x.score)[0];
    const tie = plan.assets.filter((a) => a !== best?.a).some((a) => [...words(a.title)].filter((w) => fw.has(w)).length + (fw.has("inconsistente") && a.priceStatus === "inconsistente" ? 0.5 : 0) === best?.score);
    if (best && best.score >= 1 && !tie && assetByRef.get(best.a.ref)) {
      r.hypothesesLinked.push(`${f.dedup_key!.slice(4)} → ${best.a.ref}`);
      if (!opts.dryRun) await db.from("findings").update({ asset_id: assetByRef.get(best.a.ref)! }).eq("id", f.id);
    }
  }
  void today;
  return r;
}
