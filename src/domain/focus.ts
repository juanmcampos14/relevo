// Foco de RELEVO: lo que merece la atención de la persona ahora. RELEVO lo propone (síntesis de la misión),
// cada acción lo cambia al instante y la persona lo corrige en un segundo ("esto primero", "mañana",
// "sacame esto"). Las correcciones también son información para el Brain: quedan en el registro y la
// próxima síntesis las respeta. Puro y testeable.

export type FocusStatus = "activa" | "hecha" | "sacada" | "pospuesta";
export type FocusMove = { text: string; citations: string[]; at: string };
export type FocusItem = {
  id: string;
  title: string;
  why: string;
  refs: string[];
  /** "hoy" o "semana" según la síntesis; lo que agrega la persona es "hoy". */
  tier: "hoy" | "semana";
  source: "relevo" | "persona";
  status: FocusStatus;
  rank: number;
  /** Pospuesta hasta ese día (AAAA-MM-DD). */
  until?: string | null;
  /** Qué pasó (lo hizo, por qué lo sacó, qué sigue). */
  note?: string | null;
  /** La persona la ubicó a mano: la síntesis no la reordena. */
  pinned?: boolean;
  /** De quién del equipo es este movimiento (user id); null = de cualquiera. Ahora es personal. */
  for_user?: string | null;
  /** Empresas o personas de esta prioridad con las que ya se dio el paso (si son varias). */
  done_refs?: string[];
  /** Avanzar ya preparado en background (para responder al instante). */
  move?: FocusMove | null;
  updated_at: string;
};
export type FocusLog = { at: string; by: string | null; item: string; what: string; note?: string | null };
export type Focus = { items: FocusItem[]; log: FocusLog[] };

export const EMPTY_FOCUS: Focus = { items: [], log: [] };
const LOG_MAX = 60;
const day = (iso: string) => iso.slice(0, 10);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** ¿Es la misma cosa? Comparten una referencia a una empresa o persona, o el mismo título. */
export function sameItem(a: { title: string; refs: string[] }, b: { title: string; refs: string[] }): boolean {
  const key = (r: string) => /^(company|contact|establishment|asset|finding):/.test(r);
  const ra = new Set(a.refs.filter(key));
  if (b.refs.some((r) => key(r) && ra.has(r))) return true;
  return norm(a.title) === norm(b.title);
}

/** Lo que se ve ahora: activas (o pospuestas cuyo día llegó), primero las de hoy, en el orden de la persona. */
export function visible(focus: Focus, now: Date, max = 3, me?: string | null): FocusItem[] {
  const today = day(now.toISOString());
  const live = focus.items
    .filter((x) => x.status === "activa" || (x.status === "pospuesta" && (x.until ?? "9999") <= today))
    // Ahora es personal dentro de lo compartido: lo mío y lo de cualquiera (no lo que es de otro).
    .filter((x) => !me || !x.for_user || x.for_user === me)
    .sort((a, b) => a.rank - b.rank);
  const hoy = live.filter((x) => x.tier === "hoy");
  // Si lo de hoy está resuelto, aparece lo siguiente de la semana. Nunca se fuerza a tres.
  return (hoy.length ? hoy : live.slice(0, 1)).slice(0, max);
}

/**
 * Nueva síntesis → foco. Conserva lo que la persona decidió: lo que sacó o hizo no vuelve (por 7 días),
 * lo que fijó mantiene su lugar, lo que agregó sigue. Lo demás se reemplaza por lo que propone RELEVO.
 */
export function mergeSynthesis(focus: Focus, proposed: { today: { title: string; why: string; refs: string[]; for_user?: string | null }[]; week: { title: string; why: string; refs: string[]; for_user?: string | null }[] }, now: Date, newId: () => string): Focus {
  const at = now.toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const closed = focus.items.filter((x) => (x.status === "hecha" || x.status === "sacada") && x.updated_at >= weekAgo);
  const kept = focus.items.filter((x) => (x.status === "activa" || x.status === "pospuesta") && (x.pinned || x.source === "persona"));
  const previous = focus.items.filter((x) => x.status === "activa" || x.status === "pospuesta");
  const next: FocusItem[] = [...kept];
  const add = (p: { title: string; why: string; refs: string[]; for_user?: string | null }, tier: "hoy" | "semana") => {
    if (closed.some((c) => sameItem(c, p)) || next.some((n) => sameItem(n, p))) return;
    const prev = previous.find((x) => sameItem(x, p));
    // Si es la misma cosa, se conserva su id, su estado (pospuesta) y el Avanzar ya preparado si el título no cambió.
    next.push({
      id: prev?.id ?? newId(), title: p.title, why: p.why, refs: p.refs, tier, source: "relevo", for_user: p.for_user ?? null,
      status: prev?.status ?? "activa", until: prev?.until ?? null, note: prev?.note ?? null, rank: 0,
      move: prev && norm(prev.title) === norm(p.title) ? prev.move ?? null : null, updated_at: prev && norm(prev.title) === norm(p.title) ? prev.updated_at : at,
    });
  };
  proposed.today.forEach((p) => add(p, "hoy"));
  proposed.week.forEach((p) => add(p, "semana"));
  // Orden: lo fijado por la persona primero (en su orden), después lo de hoy y lo de la semana como lo propone RELEVO.
  const pinned = next.filter((x) => x.pinned || x.source === "persona").sort((a, b) => a.rank - b.rank);
  const rest = next.filter((x) => !(x.pinned || x.source === "persona"));
  const ordered = [...pinned, ...rest.filter((x) => x.tier === "hoy"), ...rest.filter((x) => x.tier === "semana")].map((x, i) => ({ ...x, rank: i }));
  return { items: [...ordered, ...closed], log: focus.log };
}

export type Correction =
  | { kind: "primero"; id: string }
  | { kind: "orden"; ids: string[] }
  | { kind: "posponer"; id: string; until: string; note?: string | null }
  | { kind: "sacar"; id: string; note?: string | null }
  | { kind: "hecha"; id: string; note?: string | null }
  | { kind: "agregar"; id: string; title: string; why?: string | null; refs?: string[]; first?: boolean }
  | { kind: "reactivar"; ids: string[] };

const LABEL: Record<Correction["kind"], string> = { primero: "la puso primero", orden: "reordenó", posponer: "la pospuso", sacar: "la sacó", hecha: "la dio por hecha", agregar: "la agregó", reactivar: "deshizo y la volvió a traer" };

/** Aplica una corrección de la persona (o de RELEVO al registrar que algo se hizo) y la deja en el registro. */
export function correct(focus: Focus, c: Correction, by: string | null, now: Date): Focus {
  const at = now.toISOString();
  let items = focus.items.map((x) => ({ ...x }));
  const find = (id: string) => items.find((x) => x.id === id);
  const reRank = (ids: string[]) => {
    const order = new Map(ids.map((id, i) => [id, i]));
    const live = items.filter((x) => x.status === "activa" || x.status === "pospuesta").sort((a, b) => (order.get(a.id) ?? 1000 + a.rank) - (order.get(b.id) ?? 1000 + b.rank));
    live.forEach((x, i) => { x.rank = i; });
  };
  let title = "";
  switch (c.kind) {
    case "primero": {
      const it = find(c.id); if (!it) return focus;
      it.pinned = true; it.tier = "hoy"; it.status = "activa"; it.until = null; it.updated_at = at; title = it.title;
      reRank([c.id]);
      break;
    }
    case "orden": {
      reRank(c.ids);
      c.ids.forEach((id) => { const it = find(id); if (it) { it.pinned = true; it.updated_at = at; } });
      title = c.ids.map((id) => find(id)?.title).filter(Boolean).join(" › ");
      break;
    }
    case "posponer": case "sacar": case "hecha": {
      const it = find(c.id); if (!it) return focus;
      it.status = c.kind === "posponer" ? "pospuesta" : c.kind === "sacar" ? "sacada" : "hecha";
      it.until = c.kind === "posponer" ? c.until : null;
      it.note = c.note ?? it.note ?? null; it.updated_at = at; title = it.title;
      break;
    }
    case "reactivar": {
      const back = c.ids.map(find).filter((x): x is FocusItem => !!x);
      if (!back.length) return focus;
      back.forEach((it) => { it.status = "activa"; it.until = null; it.note = null; it.updated_at = at; });
      reRank(c.ids);
      title = back.map((x) => x.title).join(" · ");
      break;
    }
    case "agregar": {
      const item: FocusItem = { id: c.id, title: c.title, why: c.why ?? "", refs: c.refs ?? [], tier: "hoy", source: "persona", status: "activa", rank: c.first ? -1 : items.length, pinned: true, updated_at: at };
      items = [...items, item];
      reRank(c.first ? [c.id] : []);
      title = c.title;
      break;
    }
  }
  const note = "note" in c ? c.note ?? null : null;
  const log: FocusLog[] = [{ at, by, item: title, what: LABEL[c.kind] + (c.kind === "posponer" ? ` hasta el ${c.until}` : ""), note }, ...focus.log].slice(0, LOG_MAX);
  return { items, log };
}

/** Algo se hizo con una empresa o persona (p. ej. se mandó el mensaje): las prioridades que eran eso se resuelven. */
export function resolveByRefs(focus: Focus, refs: string[], note: string, now: Date): { focus: Focus; resolved: FocusItem[] } {
  const hit = (x: FocusItem) => (x.status === "activa" || x.status === "pospuesta") && x.refs.some((r) => refs.includes(r));
  const targets = focus.items.filter(hit);
  // Una prioridad con varias empresas ("Hotel X y World Trucks") se resuelve cuando todas tuvieron su paso.
  const resolved = targets.filter((x) => {
    const keyRefs = x.refs.filter((r) => /^(company|contact):/.test(r));
    return keyRefs.length <= 1 || keyRefs.every((r) => refs.includes(r) || (x.done_refs ?? []).includes(r));
  });
  const partial = targets.filter((x) => !resolved.includes(x));
  let next = focus;
  for (const it of resolved) next = correct(next, { kind: "hecha", id: it.id, note }, null, now);
  if (partial.length) {
    const at = now.toISOString();
    next = { ...next, items: next.items.map((x) => (partial.some((p) => p.id === x.id) ? { ...x, done_refs: [...new Set([...(x.done_refs ?? []), ...refs])], move: null, updated_at: at } : x)) };
  }
  return { focus: next, resolved };
}

/** Hasta cuántas horas sirve un Avanzar preparado si la misión no cambió desde entonces (ver moveServes). */
export const MOVE_QUIET_H = 48;

/** ¿El Avanzar preparado sigue sirviendo? Si cambió la prioridad o pasaron `maxH` horas (un día), se vuelve a preparar. */
export const moveIsFresh = (it: FocusItem, now: Date, maxH = 20) => !!it.move && it.move.at >= it.updated_at && now.getTime() - new Date(it.move.at).getTime() < maxH * 3_600_000;

/** Para la síntesis: lo que la persona corrigió en los últimos días, en lenguaje humano. */
export const correctionsForBrain = (focus: Focus, now: Date) => {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  return focus.log.filter((l) => l.at >= since && l.by).slice(0, 20).map((l) => `${l.at.slice(0, 10)}: «${l.item}» — ${l.what}${l.note ? ` (${l.note})` : ""}`);
};

/** Firma de los mensajes preparados en background: se completa con el nombre de quien los manda. */
export const SIGNATURE = "[[firma]]";
export const signMessages = (text: string, fullName: string | null) =>
  fullName ? text.replaceAll(SIGNATURE, fullName) : text.replace(/^\s*\[\[firma\]\]\s*$/gm, "").replace(/Soy \[\[firma\]\],?\s*/g, "").replaceAll(SIGNATURE, "");
