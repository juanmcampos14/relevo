import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_MONTHLY_CAP_USD, budgetState, budgetWindow, type BudgetState } from "@/domain/ai-budget";

// Lo gastado se lee de ai_runs (toda llamada a la IA queda ahí con su costo, también la investigación del
// Brief). El tope se cambia con RELEVO_MONTHLY_AI_CAP_USD en Vercel.

const CACHE_MS = 60_000;
let cached: { at: number; state: BudgetState } | null = null;

export const monthlyCap = () => {
  const v = Number(process.env.RELEVO_MONTHLY_AI_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MONTHLY_CAP_USD;
};

export async function aiBudget(now = new Date()): Promise<BudgetState> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;
  const w = budgetWindow(now, monthlyCap());
  let spent = 0;
  try {
    const db = createAdminClient();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("ai_runs").select("cost_usd").gte("created_at", w.start.toISOString()).range(from, from + 999);
      if (error) throw error;
      spent += (data ?? []).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
      if ((data ?? []).length < 1000) break;
    }
  } catch {
    // Si no se puede leer el gasto, no se frena a las personas; el fondo espera.
    return { spent: 0, cap: w.cap, pace: 0, allowUser: true, allowBackground: false };
  }
  const state = budgetState(spent, w, now);
  cached = { at: Date.now(), state };
  return state;
}

export const BUDGET_USER_MESSAGE = "Llegamos al tope mensual de IA de RELEVO. Lo que ya está guardado sigue disponible; la IA vuelve el mes que viene (o si se sube el tope).";
export const BUDGET_BACKGROUND_SKIP = "tope de IA: el trabajo de fondo espera (el gasto del mes va por encima de lo previsto)";

/** El tope rige en el entorno desplegado (o si se pide explícito); en tests y scripts locales no frena. */
const enforced = () => process.env.VERCEL === "1" || process.env.RELEVO_ENFORCE_AI_BUDGET === "1";

/** null si puede correr; si no, el motivo. kind: "user" (lo pide una persona) o "background". */
export async function budgetBlock(kind: "user" | "background"): Promise<string | null> {
  if (!enforced()) return null;
  const b = await aiBudget();
  if (kind === "user" ? b.allowUser : b.allowBackground) return null;
  return kind === "user" ? BUDGET_USER_MESSAGE : BUDGET_BACKGROUND_SKIP;
}
