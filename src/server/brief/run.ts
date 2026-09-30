import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { configuredEmailProvider } from "@/server/email/provider";
import { claudeResearchEngine, claudeSynthesisEngine } from "./engines";
import { advanceBrief, briefSettings, ensureTodayBrief, type Engines, type StepOutcome } from "./pipeline";

// Orquestación: el cron arranca el brief del día y cada invocación corre UN paso y encadena el siguiente
// llamándose a sí misma (cada paso tiene su propio presupuesto de tiempo en Vercel).

export const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export function defaultEngines(): Engines {
  return { research: claudeResearchEngine(), synthesis: claudeSynthesisEngine(), email: configuredEmailProvider() };
}

/** Workspaces con el Morning Brief activado → id del brief de hoy (creado si no existía). */
export async function startDailyBriefs(): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db.from("workspaces").select("id, settings");
  const ids: string[] = [];
  for (const w of data ?? []) if (briefSettings(w.settings).enabled) ids.push(await ensureTodayBrief(db, w.id));
  return ids;
}

export async function runStep(briefId: string): Promise<StepOutcome> {
  const out = await advanceBrief(createAdminClient(), briefId, defaultEngines(), { siteUrl: siteUrl() });
  console.info("morning-brief", JSON.stringify(out));
  return out;
}

/** Pide a la ruta del cron que corra el próximo paso (nueva invocación, nuevo presupuesto). */
export async function chainStep(briefId: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET no configurado");
  await fetch(`${siteUrl()}/api/cron/brief?brief=${briefId}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000) }).catch((e) =>
    console.error("morning-brief chain", briefId, (e as Error).message),
  );
}
