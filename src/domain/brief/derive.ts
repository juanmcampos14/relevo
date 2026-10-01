import { CHANGE_LABEL, type BriefContent, type BriefSignalView, type VerticalRadarRow } from "./contract";

// Secciones que RELEVO deriva sin IA a partir de las señales (mismas reglas todos los días).

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Empresas de la memoria que la señal nombra como palabra completa (nombres de 4+ letras). */
export function matchCompanies(texts: string[], companies: { id: string; name: string }[]): string[] {
  const hay = ` ${fold(texts.join(" "))} `;
  return companies.filter((c) => {
    const n = fold(c.name);
    return n.length >= 4 && hay.includes(` ${n} `);
  }).map((c) => c.id);
}

/** Radar por vertical: qué entró hoy en cada una (para la matriz de discovery). */
export function verticalRadar(signals: BriefSignalView[], questions: { question: string; vertical: string }[]): VerticalRadarRow[] {
  const rows = new Map<string, VerticalRadarRow>();
  const row = (v: string) => rows.get(v) ?? rows.set(v, { vertical: v, signals: 0, contradictions: 0, companies: [], hypotheses: 0, questions: [], next: [] }).get(v)!;
  for (const s of signals) {
    const r = row(s.vertical);
    r.signals++;
    if (s.change === "contradicho") r.contradictions++;
    for (const c of s.companies) if (!r.companies.includes(c)) r.companies.push(c);
    r.hypotheses += s.finding_ids.length;
    if (s.suggested_action) r.next.push(s.suggested_action);
  }
  for (const q of questions) row(q.vertical).questions.push(q.question);
  return [...rows.values()].sort((a, b) => b.signals - a.signals || a.vertical.localeCompare(b.vertical));
}

/** "Qué cambió desde ayer", agrupado por tipo de cambio. */
export function changesOf(signals: BriefSignalView[]): BriefContent["changes"] {
  const out = Object.fromEntries(Object.keys(CHANGE_LABEL).map((k) => [k, [] as { key: string; headline: string }[]])) as BriefContent["changes"];
  for (const s of signals) out[s.change].push({ key: s.key, headline: s.headline });
  return out;
}

/** Período que cubre el brief: desde el último generado (o 36 h atrás) hasta ahora; los lunes cubre el fin de semana. */
export function briefPeriod(now: Date, lastGeneratedAt: Date | null): { start: Date; end: Date } {
  const fallback = new Date(now.getTime() - 36 * 3600_000);
  const floor = new Date(now.getTime() - 4 * 86_400_000);
  const start = lastGeneratedAt && lastGeneratedAt > floor ? lastGeneratedAt : lastGeneratedAt ? floor : fallback;
  return { start, end: now };
}

/** Fecha local de Argentina (UTC−3, sin horario de verano) del brief. */
export function briefDateAR(now: Date): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Investigar y entregar son horarios distintos: el email del brief de `briefDate` sale desde `deliverAt` (HH:MM, hora Argentina). */
export function deliveryDue(briefDate: string, deliverAt: string, now: Date): boolean {
  return now.getTime() >= new Date(`${briefDate}T${deliverAt}:00-03:00`).getTime();
}
