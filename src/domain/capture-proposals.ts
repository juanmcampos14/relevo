// De la extracción de IA a propuestas revisables. Determinístico: acá no se confía en la IA.
// - Los ids "existentes" que no están en las listas se descartan (no se vincula a algo inventado).
// - Una cita que no aparece textual en la nota se descarta (no se atribuye a la captura algo que no dice).
// - Los duplicados se buscan con las mismas reglas del importador, además de lo que sugiera la IA.
import { findCandidates, normalizeName } from "./crm-import/dedupe";

export type ProposalKind = "company" | "asset" | "person" | "evidence" | "finding" | "next_action";
export type Match = { type: "company" | "contact" | "finding"; id: string; name: string; reason: string };

const STOP = new Set("de del la las el los en y o a un una unos unas que por para con sin se su sus al lo es son hay posible posibles mas muy".split(" "));
function keyTokens(s: string) {
  return new Set(s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t)));
}
/** Findings parecidos por palabras clave (sin IA): protege contra duplicados que la IA no marque. */
export function similarFindings(statement: string, findings: { id: string; statement: string }[], threshold = 0.4): { id: string; statement: string; score: number }[] {
  const a = keyTokens(statement);
  return findings
    .map((f) => {
      const b = keyTokens(f.statement);
      const inter = [...a].filter((t) => b.has(t)).length;
      const union = new Set([...a, ...b]).size;
      return { id: f.id, statement: f.statement, score: union ? inter / union : 0 };
    })
    .filter((x) => x.score >= threshold)
    .sort((x, y) => y.score - x.score);
}
export type ProposalDraft = { kind: ProposalKind; position: number; payload: Record<string, unknown>; quote: string | null; matches: Match[] };

type ExtractionLike = {
  summary: string;
  company: { name: string; identified?: boolean; existing_id: string | null; resolves?: string | null; locality: string | null; activity: string | null; quote?: string | null } | null;
  asset?: { title: string; kind: string; operation: string; address_text: string | null; locality: string | null; surface_m2: number | null; quote?: string | null } | null;
  people: { key: string; name: string | null; role: string | null; institutional: boolean; existing_id: string | null; resolves?: string | null; quote?: string | null }[];
  evidence: {
    key: string;
    statement: string;
    quote: string | null;
    evidence_type: string;
    origin: "observado" | "declarado_por_persona" | "declarado_por_documento";
    stated_by: string | null;
    declared_by: string | null;
    about: "company" | "asset" | "none";
    related_findings?: { finding_id: string; stance: "supports" | "contradicts" | "contextual" }[];
  }[];
  finding_candidates: {
    statement: string;
    kind: string;
    rationale: string;
    supports: string[];
    contradicts: string[];
    existing_finding_id?: string | null;
    relation?: "nueva" | "apoya" | "contradice" | "acota" | "amplia" | "segmenta";
    refined_statement?: string | null;
    is_idea?: boolean;
  }[];
  next_actions: { title: string; why: string; contact: string | null; due: string | null }[];
};

export type ProposalContext = {
  body: string | null;
  companies: { id: string; name: string; locality: string | null; website?: string | null; phone?: string | null }[];
  contacts: { id: string; name: string; role: string | null; company: string | null }[];
  findings: { id: string; statement: string }[];
  unresolved?: { id: string; kind: "organization" | "actor"; label: string }[];
};

/** Cómo se relaciona lo nuevo con una hipótesis existente (refinar en vez de acumular contrapuestas). */
export const REFINES = new Set(["acota", "amplia", "segmenta"]);

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
  const unresolvedOf = (id: string | null | undefined, kind: "organization" | "actor") => (id && ctx.unresolved?.some((u) => u.id === id && u.kind === kind) ? id : null);
  // La relación de cada evidencia con findings existentes sale de las hipótesis candidatas.
  const relatedByKey = new Map<string, { finding_id: string; stance: "supports" | "contradicts" | "contextual" }[]>();
  for (const f of ex.finding_candidates) {
    const id = f.existing_finding_id && findingIds.has(f.existing_finding_id) ? f.existing_finding_id : null;
    if (!id) continue;
    for (const [keys, stance] of [[f.supports, "supports"], [f.contradicts, "contradicts"]] as const) {
      for (const k of keys) relatedByKey.set(k, [...(relatedByKey.get(k) ?? []).filter((r) => r.finding_id !== id), { finding_id: id, stance }]);
    }
  }

  if (ex.company?.name.trim()) {
    const c = ex.company;
    // Sin nombre propio: organización sin identificar (no una empresa del CRM ni candidata a duplicado).
    const identified = c.identified !== false;
    const known = identified && c.existing_id ? companyIds.get(c.existing_id) : undefined;
    const matches: Match[] = !identified
      ? []
      : known
        ? [{ type: "company", id: known.id, name: known.name, reason: "sugerida por la IA" }]
        : findCandidates({ id: "", name: c.name, locality: c.locality }, ctx.companies).map((m) => ({ type: "company" as const, id: m.id, name: m.name, reason: m.reason.replace(/_/g, " ") }));
    push("company", { key: "c", name: c.name.trim(), identified, resolves: identified ? unresolvedOf(c.resolves, "organization") : null, locality: c.locality, activity: c.activity }, c.quote ?? null, matches);
  }

  if (ex.asset?.title.trim()) {
    const a = ex.asset;
    push("asset", { key: "a", title: a.title.trim(), kind: a.kind, operation: a.operation, address_text: a.address_text, locality: a.locality, surface_m2: a.surface_m2 }, a.quote ?? null);
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
        ? ctx.contacts.filter((c) => normalizeName(c.name) === normalizeName(p.name!)).map((c) => ({
            type: "contact" as const,
            id: c.id,
            name: c.company ? `${c.name} (${c.company})` : c.name,
            reason: ex.company && c.company && normalizeName(c.company) === normalizeName(ex.company.name) ? "mismo nombre y misma empresa" : "solo coincide el nombre: confirmá con la empresa o el cargo",
          }))
        : [];
    push("person", { key: p.key, name: p.name?.trim() || null, role: p.role, institutional: p.institutional || !p.name, company_key: ex.company ? "c" : null, resolves: p.name?.trim() ? unresolvedOf(p.resolves, "actor") : null }, p.quote ?? null, matches);
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
      related_findings: [...(e.related_findings ?? []), ...(relatedByKey.get(e.key) ?? [])].filter((r, i, all) => findingIds.has(r.finding_id) && all.findIndex((x) => x.finding_id === r.finding_id) === i),
    }, e.quote);
  }

  for (const f of ex.finding_candidates) {
    if (!f.statement.trim()) continue;
    // Misma hipótesis que un finding existente: se propone sumar la evidencia ahí (no duplicar).
    const same = f.existing_finding_id && findingIds.has(f.existing_finding_id) ? f.existing_finding_id : null;
    const byText = similarFindings(f.statement, ctx.findings);
    const matches: Match[] = [
      ...(same ? [{ type: "finding" as const, id: same, name: ctx.findings.find((x) => x.id === same)!.statement, reason: "la IA lo identifica como la misma hipótesis" }] : []),
      ...byText.filter((x) => x.id !== same).slice(0, 2).map((x) => ({ type: "finding" as const, id: x.id, name: x.statement, reason: "redacción parecida" })),
    ];
    const relation = same ? (f.relation && f.relation !== "nueva" ? f.relation : "apoya") : "nueva";
    out.push({ kind: "finding", position: out.length, quote: null, matches, payload: {
      link_to: same,
      relation,
      // Acota, amplía o segmenta: la hipótesis existente reformulada (se registra como revisión al aceptar).
      refined_statement: same && REFINES.has(relation) && f.refined_statement?.trim() ? f.refined_statement.trim() : null,
      is_idea: f.is_idea === true,
      statement: f.statement.trim(),
      kind: f.kind,
      rationale: f.rationale,
      supports: f.supports.filter((k) => evidenceKeys.has(k)),
      contradicts: f.contradicts.filter((k) => evidenceKeys.has(k)),
      about_company: !!ex.company,
    } });
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
