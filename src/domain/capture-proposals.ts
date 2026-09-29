// De la extracción de IA a propuestas revisables. Determinístico: acá no se confía en la IA.
// - Los ids "existentes" que no están en las listas se descartan (no se vincula a algo inventado).
// - Una cita que no aparece textual en la nota se descarta (no se atribuye a la captura algo que no dice).
// - Los duplicados se buscan con las mismas reglas del importador, además de lo que sugiera la IA.
import { findCandidates, normalizeName } from "./crm-import/dedupe";

export type ProposalKind = "company" | "asset" | "person" | "evidence" | "finding" | "next_action";
export type Match = { type: "company" | "contact"; id: string; name: string; reason: string };
export type ProposalDraft = { kind: ProposalKind; position: number; payload: Record<string, unknown>; quote: string | null; matches: Match[] };

type ExtractionLike = {
  summary: string;
  company: { name: string; existing_id: string | null; locality: string | null; activity: string | null; quote: string | null } | null;
  asset?: { title: string; kind: string; operation: string; address_text: string | null; locality: string | null; surface_m2: number | null; quote: string | null } | null;
  people: { key: string; name: string | null; role: string | null; institutional: boolean; existing_id: string | null; quote: string | null }[];
  evidence: {
    key: string;
    statement: string;
    quote: string | null;
    evidence_type: string;
    origin: "observado" | "declarado_por_persona" | "declarado_por_documento";
    stated_by: string | null;
    declared_by: string | null;
    about: "company" | "asset" | "none";
    related_findings: { finding_id: string; stance: "supports" | "contradicts" | "contextual" }[];
  }[];
  finding_candidates: { statement: string; kind: string; rationale: string; supports: string[]; contradicts: string[] }[];
  next_actions: { title: string; why: string; contact: string | null; due: string | null }[];
};

export type ProposalContext = {
  body: string | null;
  companies: { id: string; name: string; locality: string | null; website?: string | null; phone?: string | null }[];
  contacts: { id: string; name: string; role: string | null; company: string | null }[];
  findings: { id: string; statement: string }[];
};

const squash = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** Ubica una cita en los segmentos de un audio transcripto: para escuchar exactamente dónde se dijo. */
export function locateInAudio(
  quote: string | null,
  audios: { mediaId: string; utterances: { start_ms: number; end_ms: number; text: string }[] }[],
): { capture_media_id: string; start_ms: number; end_ms: number } | null {
  if (!quote) return null;
  const q = squash(quote.replace(/^["“”«»']+|["“”«»']+$/g, ""));
  // Primero el segmento más preciso; si no está en uno solo, la cita puede cruzar dos consecutivos.
  for (const width of [1, 2]) {
    for (const a of audios) {
      const segs = a.utterances;
      for (let i = 0; i + width <= segs.length; i++) {
        const span = segs.slice(i, i + width);
        if (squash(span.map((s) => s.text).join(" ")).includes(q)) {
          return { capture_media_id: a.mediaId, start_ms: span[0].start_ms, end_ms: span[span.length - 1].end_ms };
        }
      }
    }
  }
  return null;
}

/** La cita solo vale si está en la nota (tolera espacios y mayúsculas). */
export function verifiedQuote(quote: string | null, body: string | null): string | null {
  if (!quote || !body) return null;
  const q = squash(quote.replace(/^["“”«»']+|["“”«»']+$/g, ""));
  return q.length >= 3 && squash(body).includes(q) ? quote.trim() : null;
}

export function buildProposals(ex: ExtractionLike, ctx: ProposalContext): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  const push = (kind: ProposalKind, payload: Record<string, unknown>, quote: string | null, matches: Match[] = []) =>
    out.push({ kind, position: out.length, payload, quote: verifiedQuote(quote, ctx.body), matches });

  const companyIds = new Map(ctx.companies.map((c) => [c.id, c]));
  const contactIds = new Map(ctx.contacts.map((c) => [c.id, c]));
  const findingIds = new Set(ctx.findings.map((f) => f.id));

  if (ex.company?.name.trim()) {
    const c = ex.company;
    const known = c.existing_id ? companyIds.get(c.existing_id) : undefined;
    const matches: Match[] = known
      ? [{ type: "company", id: known.id, name: known.name, reason: "sugerida por la IA" }]
      : findCandidates({ id: "", name: c.name, locality: c.locality }, ctx.companies).map((m) => ({ type: "company" as const, id: m.id, name: m.name, reason: m.reason.replace(/_/g, " ") }));
    push("company", { key: "c", name: c.name.trim(), locality: c.locality, activity: c.activity }, c.quote, matches);
  }

  if (ex.asset?.title.trim()) {
    const a = ex.asset;
    push("asset", { key: "a", title: a.title.trim(), kind: a.kind, operation: a.operation, address_text: a.address_text, locality: a.locality, surface_m2: a.surface_m2 }, a.quote);
  }

  const personKeys = new Set<string>();
  for (const p of ex.people) {
    const label = p.name?.trim() || p.role?.trim();
    if (!label) continue;
    personKeys.add(p.key);
    const known = p.existing_id ? contactIds.get(p.existing_id) : undefined;
    const matches: Match[] = known
      ? [{ type: "contact", id: known.id, name: known.name, reason: "sugerida por la IA" }]
      : p.name
        ? ctx.contacts.filter((c) => normalizeName(c.name) === normalizeName(p.name!)).map((c) => ({ type: "contact" as const, id: c.id, name: c.name, reason: "mismo nombre" }))
        : [];
    push("person", { key: p.key, name: p.name?.trim() || null, role: p.role, institutional: p.institutional || !p.name, company_key: ex.company ? "c" : null }, p.quote, matches);
  }

  const evidenceKeys = new Set<string>();
  for (const e of ex.evidence) {
    if (!e.statement.trim()) continue;
    evidenceKeys.add(e.key);
    const about = e.about === "company" && ex.company ? "company" : e.about === "asset" && ex.asset ? "asset" : "none";
    push("evidence", {
      key: e.key,
      statement: e.statement.trim(),
      evidence_type: e.evidence_type,
      origin: e.origin,
      stated_by: e.origin === "declarado_por_persona" && e.stated_by && personKeys.has(e.stated_by) ? e.stated_by : null,
      declared_by: e.origin === "declarado_por_documento" ? e.declared_by?.trim() || "documento o cartel" : null,
      about,
      related_findings: e.related_findings.filter((r) => findingIds.has(r.finding_id)),
    }, e.quote);
  }

  for (const f of ex.finding_candidates) {
    if (!f.statement.trim()) continue;
    push("finding", {
      statement: f.statement.trim(),
      kind: f.kind,
      rationale: f.rationale,
      supports: f.supports.filter((k) => evidenceKeys.has(k)),
      contradicts: f.contradicts.filter((k) => evidenceKeys.has(k)),
      about_company: !!ex.company,
    }, null);
  }

  for (const a of ex.next_actions) {
    if (!a.title.trim()) continue;
    push("next_action", {
      title: a.title.trim(),
      why: a.why,
      contact: a.contact && personKeys.has(a.contact) ? a.contact : null,
      due: a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null,
      about_company: !!ex.company,
    }, null);
  }
  return out;
}
