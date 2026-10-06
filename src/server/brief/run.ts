import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { configuredEmailProvider } from "@/server/email/provider";
import { claudeResearchEngine, claudeSynthesisEngine } from "./engines";
import { advanceBrief, briefSettings, ensureTodayBrief, type Engines, type StepOutcome } from "./pipeline";
import { budgetBlock } from "@/server/ai/budget";

// Orquestación: el cron arranca el brief del día y cada invocación corre UN paso y encadena el siguiente
// llamándose a sí misma (cada paso tiene su propio presupuesto de tiempo en Vercel).

export const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export function defaultEngines(): Engines {
  return { research: claudeResearchEngine(), synthesis: claudeSynthesisEngine(), email: configuredEmailProvider() };
}

/** Workspaces con el Morning Brief activado → id del brief de hoy (creado si no existía). */
/** Días del Morning Brief (0 = domingo, hora Argentina). Por costo, lunes y jueves; se cambia con RELEVO_BRIEF_DAYS ("1,2,3,4,5"). */
export function briefDays(): number[] {
  const v = (process.env.RELEVO_BRIEF_DAYS ?? "1,4").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
  return v.length ? v : [1, 4];
}

export async function startDailyBriefs(now = new Date()): Promise<string[]> {
  if (!briefDays().includes(new Date(now.getTime() - 3 * 3_600_000).getUTCDay())) return [];
  // Tope mensual de IA: el Brief es trabajo de fondo y espera si el gasto del mes va adelantado.
  const blocked = await budgetBlock("background");
  if (blocked) {
    console.info("morning-brief", blocked);
    return [];
  }
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
