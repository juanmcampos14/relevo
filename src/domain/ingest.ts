// Formato de ingesta de research externo (Morning Brief u otra automatización).
// Cada ítem se convierte en un hallazgo PENDIENTE DE REVISIÓN con su fuente.
// Nunca crea oportunidades ni cambia estados.
import { createHash } from "node:crypto";
import { z } from "zod";
import { findingKind } from "./catalogs";

export const MAX_ITEMS = 50;

export const ingestItemSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().trim().min(1).max(500),
  publisher: z.string().trim().max(200).optional(),
  published_at: z.iso.date().or(z.iso.datetime({ offset: true })).optional(),
  statement: z.string().trim().min(1).max(2000),
  kind: z.enum(findingKind.values).default("senal_de_mercado"),
  evidence: z.string().trim().max(4000).optional(),
  analysis: z.string().trim().max(4000).optional(),
  topic: z.string().trim().max(120).optional(),
  entity_hint: z.string().trim().max(200).optional(),
});
export type IngestItem = z.infer<typeof ingestItemSchema>;

export const ingestPayloadSchema = z.object({
  source_system: z.string().trim().max(80).default("morning-brief"),
  items: z.array(z.unknown()).min(1).max(MAX_ITEMS),
});

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/;

/** URL canónica para deduplicar: sin fragmento, sin parámetros de tracking, sin "/" final. */
export function canonicalUrl(raw: string) {
  const u = new URL(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  [...u.searchParams.keys()].forEach((k) => TRACKING.test(k) && u.searchParams.delete(k));
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** Misma nota + misma afirmación = mismo hallazgo, aunque llegue en dos corridas. */
export function dedupKey(url: string, statement: string) {
  const norm = statement.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  return `ingest:${createHash("sha256").update(`${canonicalUrl(url)}|${norm}`).digest("hex").slice(0, 32)}`;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
