import * as z from "zod/v4";

// El Morning Brief de una misión: una sola corrida diaria que parte de la misión (hipótesis, actores, activos,
// preguntas, avisos, agenda, descartes) y lee lo que pasa afuera también con lente de oportunidad.
// Muy corto: como mucho 5 cosas, y solo si cambian una hipótesis, una decisión, una prioridad, la agenda o
// una acción. Una re-confirmación de lo que ya sabemos no entra. "Hoy no pasó nada relevante" es un Brief válido.

export const MAX_BRIEF_ITEMS = 5;

export const BRIEF_BASIS = ["hecho", "declaracion", "aviso_comercial", "hipotesis"] as const;
export const BRIEF_MOVES = ["hipotesis", "decision", "prioridad", "agenda", "accion", "oportunidad"] as const;

export const MissionBriefSchema = z.object({
  opening: z.string().describe("Una o dos oraciones, como RELEVO poniendo al día a la persona ('Buenos días, Tano. Desde ayer hay una cosa que cambia la agenda y una posible oportunidad.'). Si no hay nada: 'Hoy no pasó nada relevante para la misión.'"),
  quiet: z.boolean().describe("true si nada cambia una hipótesis, decisión, prioridad, agenda o acción."),
  items: z.array(z.object({
    title: z.string().describe("Qué pasó, en una línea."),
    why_us: z.string().describe("Por qué importa PARA ESTA MISIÓN: qué hipótesis, actor, activo, fecha u oportunidad toca. Una o dos oraciones."),
    moves: z.array(z.enum(BRIEF_MOVES)).describe("Qué mueve: hipótesis, decisión, prioridad, agenda, acción u oportunidad. Si no mueve nada, no va en el Brief."),
    basis: z.enum(BRIEF_BASIS).describe("Qué tipo de información es: hecho (verificable), declaración (lo dice una empresa o funcionario), aviso comercial (lo dice el vendedor) o hipótesis (lectura nuestra)."),
    action: z.string().describe("Qué acción concreta sugiere (quién, qué, cuándo si se sabe)."),
    opportunity: z.string().describe("Si puede convertirse en negocio, cuál, en una línea; si no, ''."),
    connects: z.array(z.string()).describe("Refs 'tipo:uuid' de la misión que toca (solo de la memoria)."),
    source_name: z.string(),
    source_url: z.string().describe("URL de la fuente; '' si no hay una enlazable."),
  })).describe(`Como mucho ${MAX_BRIEF_ITEMS}, de lo más a lo menos importante.`),
  watching: z.string().describe("Una línea 'Sigo mirando: …' cuando hay algo que todavía no merece acción; '' si no."),
  discarded: z.array(z.object({
    title: z.string(),
    reason: z.enum(["ya_lo_sabiamos", "repetido", "sin_relacion", "sin_consecuencia", "viejo_reciclado", "ruido_seo", "lo_descartamos", "duda_de_fuente"]),
  })).describe("Lo que miraste y NO mostrás, con el motivo (máximo 25). No va en el mail: sirve para medir."),
});
export type MissionBrief = z.infer<typeof MissionBriefSchema>;

export const BASIS_TEXT: Record<(typeof BRIEF_BASIS)[number], string> = {
  hecho: "Hecho",
  declaracion: "Declaración",
  aviso_comercial: "Aviso comercial",
  hipotesis: "Hipótesis",
};
const MOVE_TEXT: Record<(typeof BRIEF_MOVES)[number], string> = {
  hipotesis: "hipótesis",
  decision: "decisión",
  prioridad: "prioridad",
  agenda: "agenda",
  accion: "acción",
  oportunidad: "oportunidad",
};

/** Lo que llega al mail: como mucho 5, solo lo que mueve algo, sin links que no sean http(s). */
export function tidyBrief(b: MissionBrief, knownRefs: Set<string>): MissionBrief {
  const items = b.items
    .filter((x) => x.moves.length > 0)
    .slice(0, MAX_BRIEF_ITEMS)
    .map((x) => ({ ...x, connects: x.connects.filter((r) => knownRefs.has(r)), source_url: /^https?:\/\//.test(x.source_url) ? x.source_url : "" }));
  const quiet = items.length === 0;
  return { ...b, items, quiet, opening: quiet && !b.quiet ? "Hoy no pasó nada relevante para la misión." : b.opening };
}

const esc = (s: string | null | undefined) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DATE_FMT = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const C = { ink: "#1C1B19", muted: "#7A746A", line: "#E8E3DA", accent: "#5B6B4E", warm: "#C9744F" };

export type MissionBriefMeta = { mission: string; briefDate: string; url: string; test?: boolean };

export function missionBriefSubject(m: MissionBriefMeta) {
  return `${m.test ? "[Prueba] " : ""}RELEVO · ${m.mission} · ${DATE_FMT.format(new Date(`${m.briefDate}T12:00:00Z`))}`;
}

export function renderMissionBriefEmail(b: MissionBrief, m: MissionBriefMeta): { subject: string; html: string; text: string } {
  const item = (x: MissionBrief["items"][number], i: number) => `<div style="margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid ${C.line}">
<p style="margin:0 0 4px;font-size:12px;color:${C.muted}">${i + 1} · <b style="color:${C.warm}">${BASIS_TEXT[x.basis]}</b> · mueve ${x.moves.map((k) => MOVE_TEXT[k]).join(", ")}</p>
<p style="margin:0 0 6px;font-size:17px;font-weight:600">${esc(x.title)}</p>
<p style="margin:0 0 6px"><b>Por qué importa:</b> ${esc(x.why_us)}</p>
${x.opportunity ? `<p style="margin:0 0 6px"><b>Oportunidad:</b> ${esc(x.opportunity)}</p>` : ""}
${x.action ? `<p style="margin:0 0 6px"><b>Qué haría:</b> ${esc(x.action)}</p>` : ""}
<p style="margin:0;font-size:13px">${x.source_url ? `<a href="${esc(x.source_url)}" style="color:${C.accent}">${esc(x.source_name || "Fuente")}</a>` : `<span style="color:${C.muted}">${esc(x.source_name || "sin fuente enlazable")}</span>`}</p>
</div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff"><div style="max-width:600px;margin:0 auto;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${C.ink}">
<p style="margin:0;font-size:12px;letter-spacing:.18em;font-weight:600">RELEVO${m.test ? ` <span style="color:${C.warm}">· PRUEBA</span>` : ""}</p>
<p style="margin:4px 0 22px;font-size:13px;color:${C.muted}">${esc(m.mission)} · ${esc(DATE_FMT.format(new Date(`${m.briefDate}T12:00:00Z`)))}</p>
<p style="margin:0 0 24px;font-size:18px">${esc(b.opening)}</p>
${b.items.map(item).join("\n")}
${b.watching ? `<p style="margin:0 0 20px;color:${C.muted}">${esc(b.watching)}</p>` : ""}
<p style="margin:24px 0 0;font-size:13px"><a href="${esc(m.url)}" style="color:${C.accent}">Abrir la misión en RELEVO</a></p>
</div></body></html>`;
  const text = [
    `RELEVO · ${m.mission}`,
    "",
    b.opening,
    "",
    ...b.items.flatMap((x, i) => [
      `${i + 1}. ${x.title} [${BASIS_TEXT[x.basis]} · mueve ${x.moves.map((k) => MOVE_TEXT[k]).join(", ")}]`,
      `   Por qué importa: ${x.why_us}`,
      ...(x.opportunity ? [`   Oportunidad: ${x.opportunity}`] : []),
      ...(x.action ? [`   Qué haría: ${x.action}`] : []),
      `   ${x.source_url || x.source_name || "sin fuente enlazable"}`,
      "",
    ]),
    ...(b.watching ? [b.watching, ""] : []),
    `Abrir la misión: ${m.url}`,
  ].join("\n");
  return { subject: missionBriefSubject(m), html, text };
}
