import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

// Contexto declarado de una misión: lo que el equipo busca, decide o define (parámetros, restricciones,
// concepto, presupuesto). No es evidencia del mundo: el Brain lo guarda aparte (campaigns.watch.declared) y lo
// usa para buscar, filtrar y contrastar. Al crear la misión queda además la foto de "lo que creíamos al
// empezar", para poder decir después qué cambió.

type Db = SupabaseClient<Database>;
export type Declared = { text: string; at: string; by?: string | null; capture_id?: string | null };
export type StartSnapshot = { at: string; objective: string | null; context: string | null; declared: string[]; hypotheses: string[] };
type Watch = { declared?: Declared[]; initial?: StartSnapshot } & Record<string, unknown>;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Suma contexto declarado a la misión (sin repetir lo que ya dijo). */
export function mergeDeclared(current: Declared[], add: string[], meta: { by?: string | null; capture_id?: string | null }, now = new Date()): Declared[] {
  const seen = new Set(current.map((d) => fold(d.text)));
  const fresh = add.map((t) => t.trim()).filter((t) => t.length > 2 && !seen.has(fold(t))).map((text) => ({ text: text.slice(0, 300), at: now.toISOString(), by: meta.by ?? null, capture_id: meta.capture_id ?? null }));
  return [...current, ...fresh].slice(-40);
}

export async function addDeclared(db: Db, campaignId: string, add: string[], meta: { by?: string | null; capture_id?: string | null }): Promise<void> {
  const { data } = await db.from("campaigns").select("watch").eq("id", campaignId).maybeSingle();
  const w = (data?.watch ?? {}) as Watch;
  const declared = mergeDeclared(w.declared ?? [], add, meta);
  if (declared.length === (w.declared ?? []).length) return;
  await db.from("campaigns").update({ watch: { ...w, declared } as unknown as Json }).eq("id", campaignId);
}

/** La foto del comienzo: qué buscábamos y qué creíamos cuando nació la misión (no se pisa). */
export async function snapshotStart(db: Db, campaignId: string): Promise<void> {
  const [{ data: c }, { data: f }] = await Promise.all([
    db.from("campaigns").select("objective, watch").eq("id", campaignId).single(),
    db.from("findings").select("statement").eq("campaign_id", campaignId).neq("review_status", "rechazado"),
  ]);
  const w = (c?.watch ?? {}) as Watch & { context?: string | null };
  if (w.initial) return;
  const initial: StartSnapshot = { at: new Date().toISOString(), objective: c?.objective ?? null, context: w.context ?? null, declared: (w.declared ?? []).map((d) => d.text), hypotheses: (f ?? []).map((x) => x.statement) };
  await db.from("campaigns").update({ watch: { ...w, initial } as unknown as Json }).eq("id", campaignId);
}
