import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { Discovery, Helper } from "@/domain/discovery";
import { companyName } from "@/server/entities";

// "Quién puede ayudar" queda guardado en cada análisis de hipótesis. Si después alguien dejó la empresa (su
// relación tiene fecha de fin y no le queda ninguna vigente), no se lo recomienda más: se avisa que ya no
// está y que hay que buscar quién lo reemplaza. No se borra nada del análisis: se filtra al mostrarlo.

type Db = SupabaseClient<Database>;
export type FormerHelper = { ref: string; name: string; note: string };

/** Personas (contact:uuid) sin ninguna relación vigente, con a dónde ya no pertenecen. */
export async function formerContacts(db: Db, refs: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(refs.filter((r) => r.startsWith("contact:")).map((r) => r.slice(8)))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await db.from("contact_links").select("contact_id, valid_until, companies(trade_name, legal_name), assets(title)").in("contact_id", ids);
  const byContact = new Map<string, typeof data>();
  for (const l of data ?? []) byContact.set(l.contact_id, [...(byContact.get(l.contact_id) ?? []), l]);
  for (const [id, links] of byContact) {
    if (!links?.length || links.some((l) => !l.valid_until)) continue;
    const last = [...links].sort((a, b) => (b.valid_until ?? "").localeCompare(a.valid_until ?? ""))[0];
    const where = last.companies ? companyName(last.companies) : last.assets?.title ?? "donde estaba";
    out.set(`contact:${id}`, `ya no está en ${where} (desde ${last.valid_until}): buscar quién lo reemplaza`);
  }
  return out;
}

/** Separa a quién recomendar de quién ya no está. */
export function splitHelpers(helpers: Helper[] | undefined, former: Map<string, string>): { current: Helper[]; no_longer: FormerHelper[] } {
  const current: Helper[] = [];
  const no_longer: FormerHelper[] = [];
  for (const h of helpers ?? []) {
    const note = former.get(h.ref);
    if (note) no_longer.push({ ref: h.ref, name: h.name.split("·")[0].trim(), note });
    else current.push(h);
  }
  return { current, no_longer };
}

export const helperRefs = (ds: (Discovery | null | undefined)[]) => ds.flatMap((d) => (d?.who_can_help ?? []).map((h) => h.ref));
