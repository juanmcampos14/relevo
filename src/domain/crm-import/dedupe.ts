// Posibles duplicados antes de crear una empresa (V12.3 + 29/09 §9). Coincidencia fuerte o
// parecido: nunca se une automáticamente; se propone y decide una persona.
import { fold } from "./map";

export type CompanyLike = { id: string; name: string; locality?: string | null; website?: string | null; phone?: string | null; tax_id?: string | null };
export type Candidate = { id: string; name: string; reason: "mismo_cuit" | "mismo_dominio" | "mismo_telefono" | "mismo_nombre" | "nombre_parecido" };

const LEGAL = /\b(s\.?\s?a\.?\s?s?|s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?u|sociedad anonima|ltda|inc)\b\.?/g;

export function normalizeName(s: string): string {
  return fold(s).replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Dominio registrable: proveedores.ypf.com → ypf.com; tienda.empresa.com.ar → empresa.com.ar. */
export function baseDomain(host: string | null): string | null {
  if (!host) return null;
  const parts = host.split(".");
  const n = /^(com|gob|gov|net|org|edu|co)\.[a-z]{2}$/.test(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/** Últimos 8 dígitos: tolera +54 9 299 / 0299 / espacios. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = p?.replace(/\D/g, "") ?? "";
  return d.length >= 8 ? d.slice(-8) : null;
}

function tokens(s: string) {
  return new Set(normalizeName(s).split(" ").filter((t) => t.length > 1));
}

function similar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.75;
}

// Dominios compartidos que no identifican a una empresa.
const GENERIC_DOMAINS = new Set(["google.com", "facebook.com", "instagram.com", "linkedin.com", "ar.linkedin.com", "wa.me"]);

export function findCandidates(incoming: CompanyLike, existing: CompanyLike[]): Candidate[] {
  const out: Candidate[] = [];
  const dom = baseDomain(domainOf(incoming.website));
  const tel = phoneKey(incoming.phone);
  const name = normalizeName(incoming.name);
  for (const e of existing) {
    if (e.id === incoming.id) continue;
    let reason: Candidate["reason"] | null = null;
    if (incoming.tax_id && e.tax_id && incoming.tax_id.replace(/\D/g, "") === e.tax_id.replace(/\D/g, "")) reason = "mismo_cuit";
    else if (dom && !GENERIC_DOMAINS.has(dom) && dom === baseDomain(domainOf(e.website))) reason = "mismo_dominio";
    else if (tel && tel === phoneKey(e.phone)) reason = "mismo_telefono";
    else if (name && name === normalizeName(e.name) && (!incoming.locality || !e.locality || fold(incoming.locality) === fold(e.locality))) reason = "mismo_nombre";
    else if (similar(incoming.name, e.name)) reason = "nombre_parecido";
    if (reason) out.push({ id: e.id, name: e.name, reason });
  }
  return out;
}

export type ContactLike = { id: string; name: string; email?: string | null; phone?: string | null; companies?: string[] };
export type ContactCandidate = { id: string; name: string; reason: "mismo_email" | "mismo_telefono" | "mismo_nombre_y_empresa" | "mismo_nombre" };

/** Cómo se explica cada coincidencia: el nombre solo, nunca confirma. */
export const CONTACT_REASON: Record<ContactCandidate["reason"], string> = {
  mismo_email: "mismo email",
  mismo_telefono: "mismo teléfono",
  mismo_nombre_y_empresa: "mismo nombre y misma empresa",
  mismo_nombre: "solo coincide el nombre: confirmá con la empresa o el cargo",
};

/**
 * Personas que ya están en RELEVO (p. ej. creadas desde una captura) y parecen la misma que llega del CRM.
 * Email y teléfono son identificadores fuertes; el nombre solo genera una sugerencia (más fuerte si
 * además coincide la empresa). Nada se fusiona solo: una persona confirma.
 */
export function findContactCandidates(incoming: ContactLike, existing: ContactLike[]): ContactCandidate[] {
  const email = incoming.email?.trim().toLowerCase() || null;
  const tel = phoneKey(incoming.phone);
  const name = normalizeName(incoming.name);
  const out: ContactCandidate[] = [];
  for (const e of existing) {
    if (e.id === incoming.id) continue;
    const sameCompany = !!incoming.companies?.length && !!e.companies?.some((c) => incoming.companies!.some((x) => normalizeName(x) === normalizeName(c)));
    const reason: ContactCandidate["reason"] | null =
      email && email === e.email?.trim().toLowerCase()
        ? "mismo_email"
        : tel && tel === phoneKey(e.phone)
          ? "mismo_telefono"
          : name && name === normalizeName(e.name)
            ? sameCompany ? "mismo_nombre_y_empresa" : "mismo_nombre"
            : null;
    if (reason) out.push({ id: e.id, name: e.name, reason });
  }
  return out;
}
