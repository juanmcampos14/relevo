import "server-only";

import * as z from "zod/v4";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { deepCall } from "./deep";
import { materialSince } from "./material";

// "Desde tu última visita": no un activity feed. Primero qué cambió (y por qué importa), después quién lo
// hizo, y qué haría. Lo escribe RELEVO con lo que aportaron los demás y lo que apareció desde entonces.

type Db = SupabaseClient<Database>;
export const CatchUpSchema = z.object({
  changed: z.array(z.string()).describe("1 a 3 oraciones: qué cambió en lo que sabemos o creemos y por qué importa ('Fran confirmó quién opera uno de los activos y eso fortaleció la hipótesis de housing'). Nombrá a la persona solo si suma."),
  next: z.string().describe("Qué haría ahora con esta persona, en una oración (o '' si nada)."),
});
export type CatchUp = z.infer<typeof CatchUpSchema>;

export async function catchUp(db: Db, o: { workspaceId: string; missionId: string; userId: string; since: string; names: Map<string, string>; doNext: string | null; client?: Pick<Anthropic, "beta"> }): Promise<CatchUp | null> {
  // Lo mismo que decide si la síntesis vuelve a pensar: solo lo material, sin lo que hizo esta persona.
  const m = await materialSince(db, { missionId: o.missionId, workspaceId: o.workspaceId, since: o.since, excludeUser: o.userId });
  if (!m.any) return null;
  const { data: mission } = await db.from("campaigns").select("name").eq("id", o.missionId).single();
  const who = (id: string | null) => (id ? o.names.get(id) ?? "alguien del equipo" : "RELEVO");
  const prompt = JSON.stringify({
    mision: mission?.name,
    cambios_materiales: m.items.slice(0, 15).map((x) => ({ que: KIND[x.kind], quien: who(x.by), dato: x.text })),
    lo_que_haria_relevo_ahora: o.doNext,
  });
  const r = await deepCall(db, { userFacing: true, workspaceId: o.workspaceId, userId: o.userId, client: o.client, promptVersion: "equipo-desde-tu-visita-v2", effort: "low", schema: CatchUpSchema, prompt,
    system: "Contás a alguien del equipo qué cambió en su misión desde su última visita. Elegí lo que cambia una decisión, una prioridad, una reunión o una oportunidad (1 a 3 cosas como mucho; si es una sola, una sola) y decí por qué importa y para qué conversación o acción. Interpretá, no listes: nada de conteos ni ids. Si un cambio es de otra persona del equipo, nombrala. Español rioplatense, corto." });
  return r.ok ? { changed: r.value.changed.slice(0, 3), next: r.value.next } : null;
}

const KIND: Record<string, string> = { senal: "señal de afuera", aporte: "aporte del equipo", hipotesis: "cambio en una hipótesis", oportunidad: "oportunidad", accion: "acción hecha", agenda: "agenda que se acerca", correccion: "corrección de prioridades" };
