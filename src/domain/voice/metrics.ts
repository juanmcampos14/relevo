// Embudo, supresión de cortes chicos y lectura del CSV de Meta. Puro y testeable.
//
// Embudo (reglas de conteo, una sesión = una visita a la landing en un navegador):
//   visitas      sesiones con evento "vista" (recargar la página no crea otra sesión)
//   inicios      sesiones que tocaron "Empezar" o eligieron en la pantalla de un toque
//   completas    respuestas enviadas (llegaron al final; no incluye "fuera de alcance")
//   elegibles    completas con exposición a Añelo (días > 0 o vínculo habitual)
//   útiles       elegibles con episodio concreto (o ausencia explícita de problema) + solución + frecuencia o costo
// Cada etapa se muestra con su denominador (la etapa anterior). Clics y reacciones de Meta miden interés por
// el mensaje; respuestas y terreno investigan la necesidad.

export type FunnelInput = { sessions: { id: string; variant: string | null; started: boolean; outcome: string | null }[]; responses: { session_id: string; eligible: boolean; useful: boolean }[] };
export type FunnelStage = { key: string; label: string; n: number; of: number | null; rate: number | null };

export function funnel(input: FunnelInput, variant?: string | null): FunnelStage[] {
  const sessions = variant === undefined ? input.sessions : input.sessions.filter((s) => s.variant === variant);
  const ids = new Set(sessions.map((s) => s.id));
  const resp = input.responses.filter((r) => ids.has(r.session_id));
  const counts = [
    ["visitas", "Visitas a la landing", sessions.length],
    ["inicios", "Inicios", sessions.filter((s) => s.started).length],
    ["completas", "Respuestas completas", resp.length],
    ["elegibles", "Elegibles", resp.filter((r) => r.eligible).length],
    ["utiles", "Con evidencia útil", resp.filter((r) => r.useful).length],
  ] as const;
  return counts.map(([key, label, n], i) => {
    const of = i ? counts[i - 1][2] : null;
    return { key, label, n, of, rate: of ? n / of : null };
  });
}

export const MIN_CELL = 5;

/**
 * Supresión de cortes chicos: toda celda con menos de MIN_CELL respuestas se oculta, y si queda una sola
 * oculta en la distribución se oculta también la siguiente más chica (si no, se deduce por resta del total).
 * Si el total es menor que MIN_CELL, se oculta toda la distribución.
 */
export function suppress(cells: { key: string; n: number }[], min = MIN_CELL): { key: string; n: number | null }[] {
  const total = cells.reduce((a, c) => a + c.n, 0);
  if (total < min) return cells.map((c) => ({ key: c.key, n: null }));
  const hidden = new Set(cells.filter((c) => c.n > 0 && c.n < min).map((c) => c.key));
  if (hidden.size === 1) {
    const next = cells.filter((c) => !hidden.has(c.key) && c.n > 0).sort((a, b) => a.n - b.n)[0];
    if (next) hidden.add(next.key);
  }
  return cells.map((c) => ({ key: c.key, n: hidden.has(c.key) ? null : c.n }));
}

// --- CSV de Ads Manager ------------------------------------------------------------------------

export type MetaRow = {
  day: string; campaign_id: string | null; adset_id: string | null; ad_id: string; ad_name: string | null;
  spend: number; currency: string; impressions: number | null; reach: number | null; link_clicks: number | null; landing_page_views: number | null;
};
export type MetaCsv = { rows: MetaRow[]; rejected: { line: number; reason: string }[]; currency: string | null; periodStart: string | null; periodEnd: string | null; columns: string[] };

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const src = text.replace(/^﻿/, "");
  const sep = (src.split("\n")[0].match(/;/g)?.length ?? 0) > (src.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row);
  return out;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
const COLS: Record<string, string[]> = {
  day: ["day", "dia", "fecha"],
  start: ["reporting starts", "inicio del informe", "inicio de los informes"],
  end: ["reporting ends", "fin del informe", "fin de los informes"],
  campaign_id: ["campaign id", "identificador de la campana", "id de la campana"],
  adset_id: ["ad set id", "identificador del conjunto de anuncios", "id del conjunto de anuncios"],
  ad_id: ["ad id", "identificador del anuncio", "id del anuncio"],
  ad_name: ["ad name", "nombre del anuncio"],
  impressions: ["impressions", "impresiones"],
  reach: ["reach", "alcance"],
  link_clicks: ["link clicks", "clics en el enlace"],
  landing_page_views: ["landing page views", "visitas a la pagina de destino", "vistas de la pagina de destino"],
};
const SPEND = /^(amount spent|importe gastado|importe invertido)\s*\(([a-z]{3})\)$/;

/** Número en formato 1,234.56 / 1.234,56 / 1234 → number (null si vacío o no numérico). */
export function num(s: string | undefined): number | null {
  const v = (s ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!v) return null;
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  const normalized = lastComma > lastDot ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
const isoDay = (s: string | undefined) => {
  const v = (s ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : null;
};

export function parseMetaCsv(text: string): MetaCsv {
  const table = parseCsv(text);
  const result: MetaCsv = { rows: [], rejected: [], currency: null, periodStart: null, periodEnd: null, columns: [] };
  if (!table.length) return { ...result, rejected: [{ line: 0, reason: "archivo vacío" }] };
  const header = table[0].map((h) => fold(h));
  result.columns = table[0];
  const idx = (k: string) => header.findIndex((h) => COLS[k].includes(h));
  const spendIdx = header.findIndex((h) => SPEND.test(h));
  if (spendIdx < 0) return { ...result, rejected: [{ line: 1, reason: "falta la columna de gasto con moneda, p. ej. «Amount spent (USD)»" }] };
  result.currency = header[spendIdx].match(SPEND)![2].toUpperCase();
  if (idx("ad_id") < 0) return { ...result, rejected: [{ line: 1, reason: "falta «Ad ID»: sin identificador no se puede cruzar con las variantes (agregalo en Columnas → Personalizar)" }] };
  const [iDay, iStart, iEnd] = [idx("day"), idx("start"), idx("end")];
  for (const [n, r] of table.slice(1).entries()) {
    const line = n + 2;
    if (/^total/i.test(r[0] ?? "") || r.every((c) => !c.trim())) continue;
    const adId = (r[idx("ad_id")] ?? "").trim();
    if (!adId || !/^\d+$/.test(adId)) { result.rejected.push({ line, reason: "sin Ad ID numérico (fila de resumen o total)" }); continue; }
    const start = isoDay(r[iStart]);
    const end = isoDay(r[iEnd]);
    const day = isoDay(r[iDay]) ?? (start && start === end ? start : null);
    if (!day) { result.rejected.push({ line, reason: "sin desglose diario: exportá con Desglose → Por tiempo → Día" }); continue; }
    const spend = num(r[spendIdx]);
    if (spend === null || spend < 0) { result.rejected.push({ line, reason: "gasto inválido" }); continue; }
    const get = (k: string) => (idx(k) >= 0 ? num(r[idx(k)]) : null);
    result.rows.push({
      day, campaign_id: idx("campaign_id") >= 0 ? r[idx("campaign_id")].trim() || null : null, adset_id: idx("adset_id") >= 0 ? r[idx("adset_id")].trim() || null : null,
      ad_id: adId, ad_name: idx("ad_name") >= 0 ? r[idx("ad_name")].trim() || null : null, spend, currency: result.currency,
      impressions: get("impressions"), reach: get("reach"), link_clicks: get("link_clicks"), landing_page_views: get("landing_page_views"),
    });
    if (!result.periodStart || day < result.periodStart) result.periodStart = day;
    if (!result.periodEnd || day > result.periodEnd) result.periodEnd = day;
  }
  return result;
}
