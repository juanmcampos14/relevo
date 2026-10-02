import "server-only";

import * as z from "zod/v4";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { deepCall } from "./deep";

// "Desde tu última visita": no un activity feed. Primero qué cambió (y por qué importa), después quién lo
// hizo, y qué haría. Lo escribe RELEVO con lo que aportaron los demás y lo que apareció desde entonces.

type Db = SupabaseClient<Database>;
export const CatchUpSchema = z.object({
  changed: z.array(z.string()).describe("1 a 3 oraciones: qué cambió en lo que sabemos o creemos y por qué importa ('Fran confirmó quién opera uno de los activos y eso fortaleció la hipótesis de housing'). Nombrá a la persona solo si suma."),
  next: z.string().describe("Qué haría ahora con esta persona, en una oración (o '' si nada)."),
});
export type CatchUp = z.infer<typeof CatchUpSchema>;

export async function catchUp(db: Db, o: { workspaceId: string; missionId: string; userId: string; since: string; names: Map<string, string>; doNext: string | null }): Promise<CatchUp | null> {
  const [{ data: ev }, { data: caps }, { data: assessed }, { data: signals }, { data: mission }] = await Promise.all([
    db.from("evidence").select("statement, created_by").eq("campaign_id", o.missionId).gt("created_at", o.since).neq("created_by", o.userId).not("created_by", "is", null).limit(20),
    db.from("captures").select("ai_summary, captured_by").eq("campaign_id", o.missionId).gt("captured_at", o.since).neq("captured_by", o.userId).limit(10),
    db.from("finding_assessments").select("summary, discovery, findings!inner(statement, campaign_id)").eq("findings.campaign_id", o.missionId).gt("created_at", o.since).limit(8),
    db.from("brief_signals").select("headline, why_it_matters").contains("campaign_ids", [o.missionId]).in("relevance", ["alta", "media"]).gt("created_at", o.since).limit(6),
    db.from("campaigns").select("name").eq("id", o.missionId).single(),
  ]);
  if (!ev?.length && !caps?.length && !assessed?.length && !signals?.length) return null;
  const who = (id: string | null) => (id ? o.names.get(id) ?? "alguien del equipo" : "RELEVO");
  const prompt = JSON.stringify({
    mision: mission?.name,
    aportes_del_equipo: [...(ev ?? []).map((e) => ({ quien: who(e.created_by), dato: e.statement })), ...(caps ?? []).map((c) => ({ quien: who(c.captured_by), captura: c.ai_summary }))],
    hipotesis_que_cambiaron: (assessed ?? []).map((a) => ({ hipotesis: (a.findings as { statement: string }).statement, lectura: a.summary, cree: (a.discovery as { belief?: string } | null)?.belief ?? null })),
    senales_nuevas: signals ?? [],
    lo_que_haria_relevo_ahora: o.doNext,
  });
  const r = await deepCall(db, { workspaceId: o.workspaceId, userId: o.userId, promptVersion: "equipo-desde-tu-visita-v1", effort: "low", schema: CatchUpSchema, prompt,
    system: "Contás a alguien del equipo qué cambió en su misión desde su última visita. Interpretá, no listes: qué cambió en lo que sabemos o creemos y por qué importa. Nada de conteos ('sumó 7 datos'), nada de ids. Español rioplatense, corto." });
  return r.ok ? { changed: r.value.changed.slice(0, 3), next: r.value.next } : null;
}
