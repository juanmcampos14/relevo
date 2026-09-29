// HOY: cómo se eligen "mis 3 prioridades". Regla explícita (no IA), para que se pueda
// explicar y auditar: primero lo vencido, después lo que tiene hora hoy, lo que bloquea a
// otros (mi voto) y el material de campo sin procesar.

export type PriorityKind = "accion_vencida" | "visita_hoy" | "voto" | "capturas" | "revision" | "accion_hoy";

export type PriorityItem = { kind: PriorityKind; title: string; detail?: string; href: string; due?: string | null };

const RANK: Record<PriorityKind, number> = {
  accion_vencida: 0,
  visita_hoy: 1,
  voto: 2,
  accion_hoy: 3,
  capturas: 4,
  revision: 5,
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

/** "Día 3 de 7", "Empieza en 5 días" o null si la misión no tiene fechas. */
export function missionDay(today: string, starts: string | null, ends: string | null): string | null {
  if (!starts) return null;
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
  const toStart = days(today, starts);
  if (toStart > 0) return toStart === 1 ? "Empieza mañana" : `Empieza en ${toStart} días`;
  if (ends && days(ends, today) > 0) return "Finalizada";
  const n = -toStart + 1;
  return ends ? `Día ${n} de ${days(starts, ends) + 1}` : `Día ${n}`;
}
