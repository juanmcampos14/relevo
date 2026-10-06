// Tope de gasto de IA por mes (toda la cuenta, todos los workspaces). Dos reglas:
//  · la conversación y lo que pide una persona corre mientras el mes no llegue al tope;
//  · el trabajo de fondo (Brief, vigilancia, preparación de la misión) solo corre si el gasto va "al día":
//    lo gastado no supera la parte del tope que corresponde a los días transcurridos. Así, si las personas
//    usan mucho, el fondo se frena solo y deja el presupuesto para ellas.
// El mes en que se activa el tope cuenta desde `since` y con el tope prorrateado a los días que quedan.

export type BudgetWindow = { start: Date; end: Date; cap: number };

export const DEFAULT_MONTHLY_CAP_USD = 20;
/** Fecha desde la que rige el tope (lo gastado antes no cuenta). */
export const BUDGET_SINCE = "2026-10-07T03:00:00Z";

/** Mes calendario de Argentina (UTC−3) que contiene `now`, recortado desde `since`, con el tope prorrateado. */
export function budgetWindow(now: Date, monthlyCap: number, since: string = BUDGET_SINCE): BudgetWindow {
  const ar = new Date(now.getTime() - 3 * 3_600_000);
  const monthStart = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1, 3));
  const monthEnd = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth() + 1, 1, 3));
  const start = new Date(Math.max(monthStart.getTime(), new Date(since).getTime()));
  const share = (monthEnd.getTime() - start.getTime()) / (monthEnd.getTime() - monthStart.getTime());
  return { start, end: monthEnd, cap: monthlyCap * Math.max(0, Math.min(1, share)) };
}

export type BudgetState = { spent: number; cap: number; pace: number; allowUser: boolean; allowBackground: boolean };

/** `pace`: lo que se puede haber gastado a esta altura del mes. El fondo corre solo por debajo de eso. */
export function budgetState(spent: number, w: BudgetWindow, now: Date): BudgetState {
  const elapsed = Math.max(0, Math.min(1, (now.getTime() - w.start.getTime()) / (w.end.getTime() - w.start.getTime())));
  // Al empezar el período, un día de margen para que el fondo pueda correr.
  const pace = Math.min(w.cap, w.cap * elapsed + w.cap / 30);
  return { spent, cap: w.cap, pace, allowUser: spent < w.cap, allowBackground: spent < pace };
}
