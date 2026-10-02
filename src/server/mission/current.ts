import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// En qué misión está trabajando la persona. RELEVO es el motor; la misión es el contexto: se elige al entrar
// (o se dice: "entrá a Vaca Muerta") y todo lo que se ve, se pregunta y se captura queda en ese contexto.

type Db = SupabaseClient<Database>;
export const MISSION_COOKIE = "relevo-mision";

export type MissionOption = { id: string; name: string; short: string; objective: string | null };

const shortOf = (name: string) => name.split("—")[0].trim();

export async function listMissions(db: Db): Promise<MissionOption[]> {
  const { data } = await db.from("campaigns").select("id, name, objective, starts_on, created_at").eq("kind", "mision").eq("status", "activa").order("created_at");
  return (data ?? []).map((m) => ({ id: m.id, name: m.name, short: shortOf(m.name), objective: m.objective }));
}

/** La misión elegida en este navegador, si sigue activa. */
export async function chosenMission(db: Db): Promise<string | null> {
  let id: string | undefined;
  try {
    id = (await cookies()).get(MISSION_COOKIE)?.value;
  } catch {
    return null; // fuera de un request (cron, scripts)
  }
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await db.from("campaigns").select("id").eq("id", id).eq("kind", "mision").eq("status", "activa").maybeSingle();
  return data?.id ?? null;
}

/** La misión de trabajo: la elegida; si hay una sola, esa; si no, la primera (para quien todavía no eligió). */
export async function workingMission(db: Db): Promise<string | null> {
  const chosen = await chosenMission(db);
  if (chosen) return chosen;
  return (await listMissions(db))[0]?.id ?? null;
}

export async function rememberMission(id: string): Promise<void> {
  (await cookies()).set(MISSION_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
}
