import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { normalizeName } from "@/domain/crm-import/dedupe";

// Lo que RELEVO descubre (vigilancia, Morning Brief) entra a la memoria sin que nadie lo apruebe cuando la
// identificación es clara: guardar → vincular a la misión → auditar → poder deshacer. Si podría ser algo que
// ya conocemos, no se duplica ni se adivina: queda UNA pregunta ("¿Es la misma que PECOM?").

type Db = SupabaseClient<Database>;

export type Discovered = { kind: "empresa" | "persona" | "activo"; name: string; detail: string; company: string; maybe: string; source_url?: string | null; source_title?: string | null; signal_id?: string | null };
export type IngestEffects = { table: "companies" | "contacts" | "assets" | "campaign_targets"; id: string; created: boolean; target_id: string | null; link_id: string | null; source_id: string | null; mission_id?: string };

const similar = (a: string, b: string) => {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  return x !== y && x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
};

async function sourceFor(db: Db, workspaceId: string, d: Discovered): Promise<string | null> {
  if (!d.source_url || !/^https?:\/\//.test(d.source_url)) return null;
  const { data: s } = await db.from("sources").select("id").eq("url", d.source_url).limit(1);
  if (s?.[0]) return s[0].id;
  const { data } = await db.from("sources").insert({ workspace_id: workspaceId, kind: "research_externo", title: (d.source_title ?? new URL(d.source_url).hostname).slice(0, 300), url: d.source_url, notes: "Encontrada por la vigilancia de RELEVO." }).select("id").single();
  return data?.id ?? null;
}

async function ensureTarget(db: Db, workspaceId: string, missionId: string, col: "company_id" | "asset_id", id: string): Promise<string | null> {
  const { data: t } = await db.from("campaign_targets").select("id").eq("campaign_id", missionId).eq(col, id).maybeSingle();
  if (t) return null;
  const { data } = await db.from("campaign_targets").insert({ workspace_id: workspaceId, campaign_id: missionId, [col]: id } as never).select("id").single();
  return (data as { id: string } | null)?.id ?? null;
}

/** Deja auditado lo que entró solo (y cómo deshacerlo). */
async function audit(db: Db, workspaceId: string, d: Discovered, summary: string, e: IngestEffects) {
  const { data } = await db
    .from("ai_action_drafts")
    .insert({ workspace_id: workspaceId, conversation_id: null, action: "ingest_candidate", payload: d as unknown as NonNullable<Json>, rationale: summary, evidence_refs: [], preview: { summary, changes: [], why: d.detail, evidence_refs: [], duplicate_risk: [], expected: summary, applied: true } as never })
    .select("id")
    .single();
  if (data) await db.from("ai_action_drafts").update({ status: "ejecutada", decided_at: new Date().toISOString(), after_state: e as unknown as Json }).eq("id", data.id);
}

async function ask(db: Db, workspaceId: string, missionId: string, d: Discovered, question: string, maybeRef: string | null) {
  const { data: dup } = await db.from("brief_candidates").select("id").eq("campaign_id", missionId).eq("status", "candidato").ilike("name", d.name).limit(1);
  if (dup?.length) return;
  await db.from("brief_candidates").insert({ workspace_id: workspaceId, brief_id: null, campaign_id: missionId, kind: d.kind, name: d.name.slice(0, 200), detail: d.detail.slice(0, 600), source_url: d.source_url && /^https?:\/\//.test(d.source_url) ? d.source_url : null, question, maybe_ref: maybeRef, payload: { company: d.company, signal_id: d.signal_id ?? null } as NonNullable<Json> });
}

export async function ingestDiscovery(db: Db, opts: { workspaceId: string; missionId: string; force?: boolean }, items: Discovered[]): Promise<{ ingested: number; questions: number }> {
  let ingested = 0;
  let questions = 0;
  for (const d of items) {
    const name = d.name.trim();
    if (name.length < 2) continue;
    if (d.maybe && !opts.force) {
      await ask(db, opts.workspaceId, opts.missionId, d, d.kind === "activo" ? `¿${name} es un activo nuevo? ¿Lo sigo?` : `¿${name} es la misma que ya conocemos?`, d.maybe);
      questions++;
      continue;
    }
    if (d.kind === "empresa") {
      const { data: all } = await db.from("companies").select("id, trade_name, legal_name").limit(2000);
      const exact = (all ?? []).find((c) => [c.trade_name, c.legal_name].some((n) => n && normalizeName(n) === normalizeName(name)));
      const near = (all ?? []).find((c) => [c.trade_name, c.legal_name].some((n) => n && similar(n, name)));
      if (exact) {
        const target = await ensureTarget(db, opts.workspaceId, opts.missionId, "company_id", exact.id);
        if (target) await audit(db, opts.workspaceId, d, `${name} ya estaba en la memoria: la sumé a la misión.`, { mission_id: opts.missionId, table: "campaign_targets", id: target, created: true, target_id: target, link_id: null, source_id: null });
        continue;
      }
      if (near && !opts.force) { await ask(db, opts.workspaceId, opts.missionId, d, `¿${name} es la misma que ${near.trade_name ?? near.legal_name}?`, `company:${near.id}`); questions++; continue; }
      const source_id = await sourceFor(db, opts.workspaceId, d);
      const { data: c } = await db.from("companies").insert({ workspace_id: opts.workspaceId, origin_campaign_id: opts.missionId, trade_name: name.slice(0, 200), notes: `${d.detail} — Detectada por la vigilancia de RELEVO (sin verificar).`, verification_status: "unverified", source_id }).select("id").single();
      if (!c) continue;
      const target = await ensureTarget(db, opts.workspaceId, opts.missionId, "company_id", c.id);
      await audit(db, opts.workspaceId, d, `Sumé ${name} a la memoria y a la misión.`, { mission_id: opts.missionId, table: "companies", id: c.id, created: true, target_id: target, link_id: null, source_id });
      ingested++;
    } else if (d.kind === "persona") {
      const { data: people } = await db.from("contacts").select("id, full_name").limit(3000);
      if (!opts.force && (people ?? []).some((p) => normalizeName(p.full_name) === normalizeName(name) || similar(p.full_name, name))) {
        const p = (people ?? []).find((x) => normalizeName(x.full_name) === normalizeName(name) || similar(x.full_name, name))!;
        await ask(db, opts.workspaceId, opts.missionId, d, `¿${name} es ${p.full_name}, que ya conocemos?`, `contact:${p.id}`);
        questions++;
        continue;
      }
      const { data: companies } = d.company ? await db.from("companies").select("id, trade_name, legal_name").limit(2000) : { data: [] };
      const company = (companies ?? []).find((c) => [c.trade_name, c.legal_name].some((n) => n && normalizeName(n) === normalizeName(d.company)));
      const source_id = await sourceFor(db, opts.workspaceId, d);
      const { data: p } = await db.from("contacts").insert({ workspace_id: opts.workspaceId, origin_campaign_id: opts.missionId, full_name: name.slice(0, 200), notes: `${d.detail} — Detectada por la vigilancia de RELEVO (sin verificar).`, verification_status: "unverified", source_id }).select("id").single();
      if (!p) continue;
      let link_id: string | null = null;
      if (company) {
        const { data: l } = await db.from("contact_links").insert({ workspace_id: opts.workspaceId, contact_id: p.id, company_id: company.id, relation: "otro" }).select("id").single();
        link_id = l?.id ?? null;
      }
      await audit(db, opts.workspaceId, d, `Sumé a ${name}${company ? ` (${company.trade_name ?? company.legal_name})` : ""} a la memoria.`, { mission_id: opts.missionId, table: "contacts", id: p.id, created: true, target_id: null, link_id, source_id });
      ingested++;
    } else {
      const { data: assets } = await db.from("assets").select("id, title").limit(2000);
      const near = (assets ?? []).find((a) => normalizeName(a.title) === normalizeName(name) || similar(a.title, name));
      if (near && !opts.force) { await ask(db, opts.workspaceId, opts.missionId, d, `¿${name} es el mismo activo que ${near.title}?`, `asset:${near.id}`); questions++; continue; }
      const { data: a } = await db.from("assets").insert({ workspace_id: opts.workspaceId, origin_campaign_id: opts.missionId, kind: "otro", title: name.slice(0, 200), locality: d.company || null, operation: "desconocida", verification_status: "unverified", price_status: "sin_validar", notes: `${d.detail} — Detectado por la vigilancia de RELEVO (sin verificar).` }).select("id").single();
      if (!a) continue;
      const target = await ensureTarget(db, opts.workspaceId, opts.missionId, "asset_id", a.id);
      await audit(db, opts.workspaceId, d, `Empecé a seguir ${name}.`, { mission_id: opts.missionId, table: "assets", id: a.id, created: true, target_id: target, link_id: null, source_id: null });
      ingested++;
    }
  }
  return { ingested, questions };
}

/** Deshacer lo que entró solo: se borra lo creado (si nadie más lo usó) o se saca de la misión. */
export async function undoIngest(db: Db, e: IngestEffects): Promise<void> {
  if (e.link_id) await db.from("contact_links").delete().eq("id", e.link_id);
  if (e.target_id) await db.from("campaign_targets").delete().eq("id", e.target_id);
  if (e.created && e.table !== "campaign_targets") await db.from(e.table).delete().eq("id", e.id);
}

/** Candidatos del Morning Brief: lo claro entra solo a la misión que sigue el Brief; lo dudoso queda como pregunta. */
export async function ingestBriefCandidates(db: Db, opts: { workspaceId: string; missionId: string }): Promise<{ ingested: number; questions: number }> {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data } = await db.from("brief_candidates").select("id, kind, name, detail, source_url, payload").eq("status", "candidato").not("brief_id", "is", null).in("kind", ["empresa", "persona", "activo"]).gte("created_at", since).limit(30);
  if (!data?.length) return { ingested: 0, questions: 0 };
  const items: Discovered[] = data.map((c) => ({ kind: c.kind as Discovered["kind"], name: c.name, detail: c.detail ?? "", company: String((c.payload as { locality?: string; company?: string } | null)?.company ?? (c.payload as { locality?: string } | null)?.locality ?? ""), maybe: "", source_url: c.source_url, source_title: null }));
  const r = await ingestDiscovery(db, opts, items);
  // Procesados por RELEVO: lo que entró está en la memoria; lo dudoso, como pregunta en la misión.
  await db.from("brief_candidates").update({ status: "aprobado", decided_at: new Date().toISOString() }).in("id", data.map((c) => c.id));
  return r;
}
