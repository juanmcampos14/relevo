// HOY: cómo se eligen "mis 3 prioridades". Regla explícita (no IA), para que se pueda
// explicar y auditar: primero lo vencido, después lo que tiene hora hoy, lo que bloquea a
// otros (mi voto) y el material de campo sin procesar.

export type PriorityKind = "accion_vencida" | "visita_hoy" | "contradiccion" | "voto" | "validar" | "segundo_caso" | "accion_hoy" | "capturas" | "revision";

/** why: la razón en una frase ("esto es lo más importante porque…"). */
export type PriorityItem = { kind: PriorityKind; title: string; detail?: string; why?: string; href: string; due?: string | null };

// Lo vencido y lo que tiene hora hoy primero; después lo que más reduce incertidumbre
// (una contradicción abierta, una validación por decidir, un segundo caso); después el resto.
const RANK: Record<PriorityKind, number> = {
  accion_vencida: 0,
  visita_hoy: 1,
  contradiccion: 2,
  voto: 3,
  validar: 4,
  segundo_caso: 5,
  accion_hoy: 6,
  capturas: 7,
  revision: 8,
};

// Fran decide: su voto va primero; el resto del orden se mantiene.
const RANK_EJECUTIVO: Record<PriorityKind, number> = { ...RANK, voto: -1 };

export function pickPriorities(items: PriorityItem[], view: "operativa" | "ejecutiva", max = 3): PriorityItem[] {
  const rank = view === "ejecutiva" ? RANK_EJECUTIVO : RANK;
  return [...items]
    .sort((a, b) => rank[a.kind] - rank[b.kind] || (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, max);
}

/** Fecha ISO (AAAA-MM-DD) + n días, sin zona horaria. */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Contexto temporal de la misión para HOY: antes, durante y después. Null si no tiene fechas. */
export function missionDay(today: string, starts: string | null, ends: string | null): { label: string; phase: "antes" | "durante" | "despues" } | null {
  if (!starts) return null;
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
  const toStart = days(today, starts);
  if (toStart > 0) return { phase: "antes", label: toStart === 1 ? "Falta 1 día" : `Faltan ${toStart} días` };
  if (ends && days(ends, today) > 0) return { phase: "despues", label: "Misión finalizada · toca sintetizar" };
  const n = -toStart + 1;
  return { phase: "durante", label: ends ? `Día ${n} de ${days(starts, ends) + 1}` : `Día ${n}` };
}
