import { BASIS_LABEL, CHANGE_LABEL, SECTION_LABEL, SIGNAL_TYPE_LABEL, type BriefContent, type BriefSignalView } from "./contract";

// El email es una representación del brief guardado, no la memoria. Misma función para los tres destinatarios.

export type BriefMeta = { briefId: string; briefDate: string; workspaceName: string; url: string };

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DATE_FMT = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const briefDateLabel = (d: string) => DATE_FMT.format(new Date(`${d}T12:00:00Z`));

const SHORT_FMT = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
/** Asunto fijo y corto: la inteligencia va adentro. «RELEVO Morning Brief | 01 Oct | Vaca Muerta». */
export function briefSubject(_c: BriefContent, m: BriefMeta) {
  const parts = SHORT_FMT.formatToParts(new Date(`${m.briefDate}T12:00:00Z`));
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  const mon = (parts.find((p) => p.type === "month")?.value ?? "").replace(".", "");
  return `RELEVO Morning Brief | ${d} ${mon.charAt(0).toUpperCase()}${mon.slice(1, 3)} | Vaca Muerta`;
}

const C = { ink: "#111827", muted: "#6b7280", line: "#e5e7eb", accent: "#0f766e", warn: "#b45309", bad: "#b91c1c" };
const h2 = (n: string, t: string) =>
  `<h2 style="margin:28px 0 10px;font-size:13px;letter-spacing:.08em;color:${C.accent};text-transform:uppercase">${n} — ${esc(t)}</h2>`;
const tag = (t: string, color = C.muted) =>
  `<span style="display:inline-block;margin-right:6px;padding:1px 6px;border:1px solid ${color};border-radius:4px;font-size:11px;color:${color}">${esc(t)}</span>`;
const changeColor = (c: BriefSignalView["change"]) => (c === "contradicho" ? C.bad : c === "nuevo" ? C.accent : c === "descartado" ? C.muted : C.warn);

function signalHtml(s: BriefSignalView) {
  const meta = [s.happened_on, s.geography, s.vertical, s.subsector].filter(Boolean).map(esc).join(" · ");
  const who = [...s.companies, ...s.people].map(esc).join(", ");
  return `<div style="margin:0 0 16px;padding:0 0 14px;border-bottom:1px solid ${C.line}">
<div>${tag(CHANGE_LABEL[s.change], changeColor(s.change))}${tag(BASIS_LABEL[s.basis])}${tag(SIGNAL_TYPE_LABEL[s.signal_type])}${s.relevance === "alta" ? tag("relevancia alta", C.warn) : ""}</div>
<p style="margin:6px 0 2px;font-weight:600;font-size:15px">${esc(s.headline)}</p>
<p style="margin:0 0 4px;color:${C.muted};font-size:12px">${meta}${who ? ` · ${who}` : ""}</p>
<p style="margin:0 0 4px">${esc(s.summary)}</p>
${s.why_it_matters ? `<p style="margin:0 0 4px"><b>Por qué importa:</b> ${esc(s.why_it_matters)}</p>` : ""}
${s.reading ? `<p style="margin:0 0 4px"><b>Lectura RELEVO</b> <i>(inferencia)</i>: ${esc(s.reading)}</p>` : ""}
${s.verify ? `<p style="margin:0 0 4px"><b>Qué falta comprobar:</b> ${esc(s.verify)}</p>` : ""}
${s.talk_to ? `<p style="margin:0 0 4px"><b>Con quién hablar:</b> ${esc(s.talk_to)}</p>` : ""}
${s.ask ? `<p style="margin:0 0 4px"><b>Qué preguntar (AOG / campo):</b> ${esc(s.ask)}</p>` : ""}
${s.same_as ? `<p style="margin:0 0 4px;color:${C.muted};font-size:12px">Ya conocido${s.same_as.on ? ` desde el ${esc(s.same_as.on)}` : ""}: esta fuente suma evidencia a «${esc(s.same_as.headline.slice(0, 90))}».</p>` : ""}
${s.story_title ? `<p style="margin:0 0 4px;color:${C.muted};font-size:12px">Historia: ${esc(s.story_title)}</p>` : ""}
${s.source_url ? `<p style="margin:0;font-size:12px"><a href="${esc(s.source_url)}" style="color:${C.accent}">${esc(s.publisher || s.source_title || "fuente")}</a></p>` : `<p style="margin:0;font-size:12px;color:${C.muted}">sin fuente enlazable</p>`}
</div>`;
}

const list = (items: string[]) => (items.length ? `<ul style="margin:0;padding-left:18px">${items.map((i) => `<li style="margin:0 0 6px">${i}</li>`).join("")}</ul>` : `<p style="color:${C.muted};margin:0">—</p>`);

export const modeLabel = (m: "completo" | "reducido") => (m === "reducido" ? "MODO REDUCIDO (tope mensual alcanzado: sin búsqueda web)" : "MODO COMPLETO");
export function metricsLine(m: NonNullable<BriefContent["metrics"]>) {
  return `${m.signals} señales (${m.signalsVmn} de Vaca Muerta News) · ${m.collected} notas leídas (${m.collectedVmn} de Vaca Muerta News) · ${m.webSearches} búsquedas web · ${m.sourcesCited} fuentes citadas · ${m.stories} historias tocadas · ${m.candidates} candidatos · costo USD ${m.costUsd.toFixed(2)} (mes: USD ${m.monthCostUsd.toFixed(2)} de ${m.monthlyCapUsd})`;
}

export function renderBriefEmail(c: BriefContent, m: BriefMeta): { subject: string; html: string; text: string } {
  const bySection = (sec: BriefSignalView["section"]) => c.signals.filter((s) => s.section === sec);
  const parts: string[] = [];
  parts.push(`<p style="margin:0;color:${C.muted};font-size:12px">RELEVO · ${esc(m.workspaceName)}</p>
<h1 style="margin:4px 0 0;font-size:22px">Morning Brief · ${esc(briefDateLabel(m.briefDate))}</h1>`);
  if (c.metrics) parts.push(`<p style="margin:10px 0 0;font-size:12px;color:${C.muted}"><b style="color:${c.metrics.mode === "reducido" ? C.warn : C.accent}">${modeLabel(c.metrics.mode)}</b> · ${metricsLine(c.metrics)}</p>`);
  if (c.quiet_day_note) parts.push(`<p style="margin:12px 0 0;padding:10px;background:#f9fafb;border-radius:6px">${esc(c.quiet_day_note)}</p>`);
  parts.push(h2("01", "Lo que importa hoy"), list(c.headline_points.map((p) => esc(p.text))));
  (["general", "anelo", "empresas", "activos"] as const).forEach((sec, i) => {
    const ss = bySection(sec);
    parts.push(h2(String(i + 2).padStart(2, "0"), SECTION_LABEL[sec]), ss.length ? ss.map(signalHtml).join("") : `<p style="color:${C.muted};margin:0">Sin novedades en esta sección.</p>`);
  });
  parts.push(
    h2("06", "Radar de verticales"),
    list(c.vertical_radar.map((r) => `<b>${esc(r.vertical)}</b>: ${r.signals} señal${r.signals === 1 ? "" : "es"}${r.contradictions ? `, ${r.contradictions} contradicción(es)` : ""}${r.companies.length ? ` · ${esc(r.companies.join(", "))}` : ""}${r.hypotheses ? ` · toca ${r.hypotheses} hipótesis` : ""}${r.questions.length ? ` · pregunta abierta: ${esc(r.questions[0])}` : ""}`)),
    h2("07", "Conexiones que RELEVO ve"),
    list(c.connections.map((x) => `${esc(x.text)} <i style="color:${C.muted}">(inferencia)</i>`)),
    h2("08", "Qué cambió desde ayer"),
    list(Object.entries(c.changes).filter(([, v]) => v.length).map(([k, v]) => `<b>${CHANGE_LABEL[k as keyof typeof CHANGE_LABEL]}</b>: ${v.map((x) => esc(x.headline)).join(" · ")}`)),
    h2("09", "Qué haría RELEVO hoy"),
    list(c.actions.map((a) => `<b>${esc(a.title)}</b> — ${esc(a.why)}`)),
    h2("10", "Candidatos para el CRM"),
    `<p style="margin:0 0 6px;color:${C.muted};font-size:12px">Detectado ≠ validado: nada entra al CRM sin aprobación en RELEVO.</p>`,
    list(c.candidates.map((x) => `${tag(x.kind)} <b>${esc(x.name)}</b> — ${esc(x.detail)}`)),
    h2("11", "Preguntas para campo"),
    list(c.field_questions.map((q) => `${esc(q.question)} <span style="color:${C.muted}">(${esc(q.vertical)})</span>`)),
    h2("12", "Watchlist"),
    list(c.watchlist.map((w) => `<b>${esc(w.title)}</b> — ${esc(w.why)}${w.since ? ` <span style="color:${C.muted}">(desde ${esc(w.since)})</span>` : ""}`)),
    h2("—", "Fuentes"),
    list(c.sources.map((s) => `<a href="${esc(s.url)}" style="color:${C.accent}">${esc(s.title)}</a>${s.publisher ? ` · ${esc(s.publisher)}` : ""}`)),
    `<p style="margin:28px 0 0;color:${C.muted};font-size:12px">Este email es una vista del brief guardado en RELEVO. <a href="${esc(m.url)}" style="color:${C.accent}">Abrir en RELEVO</a> para aprobar candidatos, convertir acciones en tareas o preguntarle a RELEVO. · brief ${esc(m.briefId)}</p>`,
  );
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff"><div style="max-width:680px;margin:0 auto;padding:24px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:${C.ink}">${parts.join("\n")}</div></body></html>`;
  return { subject: briefSubject(c, m), html, text: renderBriefText(c, m) };
}

export function renderBriefText(c: BriefContent, m: BriefMeta): string {
  const L: string[] = [`RELEVO · Morning Brief · ${briefDateLabel(m.briefDate)}`, ...(c.metrics ? [`${modeLabel(c.metrics.mode)} · ${metricsLine(c.metrics)}`] : []), ""];
  if (c.quiet_day_note) L.push(c.quiet_day_note, "");
  L.push("01 — LO QUE IMPORTA HOY", ...c.headline_points.map((p) => `• ${p.text}`), "");
  (["general", "anelo", "empresas", "activos"] as const).forEach((sec, i) => {
    L.push(`${String(i + 2).padStart(2, "0")} — ${SECTION_LABEL[sec].toUpperCase()}`);
    for (const s of c.signals.filter((x) => x.section === sec)) {
      L.push(`• [${CHANGE_LABEL[s.change]} · ${BASIS_LABEL[s.basis]}] ${s.headline}`, `  ${s.summary}`);
      if (s.reading) L.push(`  Lectura RELEVO (inferencia): ${s.reading}`);
      if (s.source_url) L.push(`  ${s.source_url}`);
    }
    L.push("");
  });
  L.push("09 — QUÉ HARÍA RELEVO HOY", ...c.actions.map((a) => `• ${a.title} — ${a.why}`), "");
  L.push("11 — PREGUNTAS PARA CAMPO", ...c.field_questions.map((q) => `• ${q.question}`), "");
  L.push(`Abrir en RELEVO: ${m.url}`, `brief ${m.briefId}`);
  return L.join("\n");
}
