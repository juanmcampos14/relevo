// RADAR DE MERCADO del Sheet → Radar de RELEVO. Mapeo PURO, reejecutable por ID (RAD-xxx).
// Observación ≠ conclusión: dos precios distintos para el mismo activo quedan como INCONSISTENTE, nunca
// como baja calculada; la variación del Sheet se conserva como dato declarado, no se recalcula.

export type RadarRow = { row: number; values: Record<string, string | null> };

export type RadarSignal = {
  ref: string;
  happenedOn: string | null;
  topic: string | null;
  headline: string;
  summary: string;
  implication: string | null;
  url: string | null;
  validation: string | null;
  nextAction: string | null;
  basis: "hecho" | "declaracion" | "inferencia";
  signalType: string;
  section: "general" | "anelo" | "empresas" | "activos";
  vertical: string;
  entity: string | null;
  location: string | null;
};
export type RadarPrice = { amount: number; currency: "USD" | "ARS"; operation: "venta" | "alquiler"; period: string | null; observedOn: string | null; url: string | null; note: string | null };
export type RadarAsset = {
  ref: string;
  title: string;
  kind: "inmueble" | "terreno" | "local" | "fondo_de_comercio" | "otro";
  operation: "venta" | "alquiler" | "desconocida";
  category: string | null;
  locality: string | null;
  capacityText: string | null;
  surfaceM2: number | null;
  landM2: number | null;
  occupancy: string | null;
  owner: string | null;
  broker: string | null;
  operator: string | null;
  saleReason: string | null;
  economics: string | null;
  firstDetectedOn: string | null;
  lastCheckedOn: string | null;
  materialChange: string | null;
  evidenceLayer: string | null;
  priceStatus: "inconsistente" | "sin_validar";
  prices: RadarPrice[];
};
export type RadarConversation = { ref: string; entity: string; topic: string; script: string; url: string | null; nextAction: string | null };
export type RadarPlan = { signals: RadarSignal[]; assets: RadarAsset[]; conversations: RadarConversation[]; skipped: { row: number; reason: string }[] };

const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const day = (v: string | null) => {
  const s = t(v);
  if (!s) return null;
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  const d = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : null;
};
const num = (v: string | null) => {
  const s = t(v);
  if (!s) return null;
  const n = Number(s.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const url = (v: Record<string, string | null>) => {
  const link = t(v["Enlace#link"]) ?? t(v["Enlace"]);
  return link && /^https?:\/\//i.test(link) ? link : null;
};

/** "415 m² cubiertos · 1.080 m² terreno" → { covered: 415, land: 1080 }. */
export function parseSurfaces(text: string | null): { covered: number | null; land: number | null } {
  if (!text) return { covered: null, land: null };
  const n = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const covered = text.match(/([\d.,]+)\s*m²\s*(?:cubiertos?|construidos?)/i)?.[1];
  const land = text.match(/([\d.,]+)\s*m²\s*(?:de\s+)?(?:terreno|lote|totales?)/i)?.[1] ?? text.match(/sobre\s+(?:lote\s+de\s+)?([\d.,]+)\s*m²/i)?.[1];
  return { covered: covered ? n(covered) : null, land: land ? n(land) : null };
}

/** Precio citado en el texto ("ARS 3.700.000/mes", "USD 980.000"): para filas sin columna de precio. */
export function priceInText(text: string): { amount: number; currency: "USD" | "ARS"; monthly: boolean } | null {
  const m = text.match(/\b(USD|US\$|U\$S|ARS|\$)\s*([\d.]+(?:,\d+)?)(?:\s*(millones|M))?\s*(\/\s*mes|mensuales?)?/i);
  if (!m) return null;
  let amount = Number(m[2].replace(/\./g, "").replace(",", "."));
  if (m[3]) amount *= 1_000_000;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: /ARS|^\$$/i.test(m[1]) ? "ARS" : "USD", monthly: !!m[4] };
}

function kindOf(category: string | null, text: string): RadarAsset["kind"] {
  const c = fold(`${category ?? ""} ${text}`);
  if (/fondo de comercio/.test(c)) return "fondo_de_comercio";
  if (/terreno|tierra|lote(?! de)/.test(c) && !/departamento|complejo|nave|galpon/.test(c)) return "terreno";
  if (/local comercial|\blocal\b/.test(c) && !/complejo|departamento/.test(c)) return "local";
  return "inmueble";
}

function typeOf(topic: string, kind: string | null): string {
  const s = fold(`${topic} ${kind ?? ""}`);
  if (/activo|housing · oferta|transaccion/.test(s)) return "activo_inmueble";
  if (/inversion|capital/.test(s)) return "inversion";
  if (/infraestructura/.test(s)) return "infraestructura";
  if (/operacion|operador|empresa|aog/.test(s)) return "movimiento_empresa";
  if (/precio|mercado/.test(s)) return "precio";
  if (/housing|comprador|pipeline/.test(s)) return "demanda";
  return "otro";
}

export function mapRadar(rows: RadarRow[]): RadarPlan {
  const plan: RadarPlan = { signals: [], assets: [], conversations: [], skipped: [] };
  for (const { row, values: v } of rows) {
    const ref = t(v["ID"]);
    const headline = t(v["Hallazgo"]);
    if (!ref || !/^RAD-/i.test(ref)) {
      if (Object.values(v).some(Boolean)) plan.skipped.push({ row, reason: "sin ID RAD-" });
      continue;
    }
    if (!headline) {
      plan.skipped.push({ row, reason: "sin hallazgo" });
      continue;
    }
    const topic = t(v["Tema"]) ?? "";
    const entity = t(v["Activo / entidad"]);
    const link = url(v);
    if (/aog\W+conversaci/i.test(fold(topic))) {
      plan.conversations.push({ ref, entity: headline, topic, script: t(v["Implicación hipotética RELEVO"]) ?? "", url: link, nextAction: t(v["Acción / responsable"]) });
      continue;
    }
    const kindText = t(v["Tipo de señal"]);
    const location = t(v["Ubicación"]);
    const isAsset = /^activo/i.test(kindText ?? "") || /^activos/i.test(topic) || (!!entity && num(v["Precio actual USD"]) !== null);
    const signalType = typeOf(topic, kindText);
    const isHousing = /housing/i.test(topic);
    plan.signals.push({
      ref,
      happenedOn: day(v["Fecha"]),
      topic: topic || null,
      headline: headline.length > 220 ? `${headline.slice(0, 217)}…` : headline,
      summary: headline,
      implication: t(v["Implicación hipotética RELEVO"]),
      url: link,
      validation: t(v["Estado validación"]),
      nextAction: t(v["Acción / responsable"]),
      basis: /^hecho/i.test(headline) || /oficial|fuente pública|verificad/i.test(v["Estado validación"] ?? "") ? "hecho" : "declaracion",
      signalType,
      section: isAsset ? "activos" : /añelo/i.test(`${location ?? ""} ${headline}`) ? "anelo" : signalType === "movimiento_empresa" || signalType === "inversion" ? "empresas" : "general",
      vertical: isAsset ? "Inmuebles / activos / fondos de comercio" : isHousing ? "Alojamiento + campamentos" : "Transversal",
      entity,
      location,
    });
    if (!isAsset) continue;
    const category = t(v["Categoría del activo"]);
    const capacityRaw = t(v["Capacidad / superficie"]);
    // Consistencia interna: si el hallazgo trae su propia superficie y la columna dice otra, la columna
    // puede venir de otra fila (copia): no se usa y se marca para revisar.
    const ownCovered = parseSurfaces(headline).covered ?? Number(headline.match(/([\d.,]+)\s*m²/)?.[1]?.replace(/\./g, "").replace(",", ".") ?? NaN);
    const colSurf = parseSurfaces(capacityRaw);
    const inconsistent = Number.isFinite(ownCovered) && colSurf.covered !== null && colSurf.covered !== ownCovered && !headline.includes(String(colSurf.covered));
    const capacity = inconsistent ? null : capacityRaw;
    const surfaces = parseSurfaces(`${capacity ?? ""} ${headline}`);
    const rental = /alquiler|\/\s*mes/i.test(headline);
    const checked = day(v["Última comprobación"]) ?? day(v["Fecha"]);
    const prices: RadarPrice[] = [];
    const current = num(v["Precio actual USD"]);
    const previous = num(v["Precio anterior USD"]);
    if (current) prices.push({ amount: current, currency: "USD", operation: rental ? "alquiler" : "venta", period: rental ? "mes" : null, observedOn: checked, url: link, note: "Precio actual según RADAR" });
    else {
      const p = priceInText(headline);
      if (p) prices.push({ amount: p.amount, currency: p.currency, operation: p.monthly || rental ? "alquiler" : "venta", period: p.monthly ? "mes" : null, observedOn: checked, url: link, note: "Precio citado en el hallazgo (sin conversión de moneda)" });
    }
    if (previous && previous !== current && !inconsistent) prices.push({ amount: previous, currency: "USD", operation: rental ? "alquiler" : "venta", period: null, observedOn: null, url: null, note: "Precio anterior según RADAR (otra publicación; fecha y fuente sin registrar)" });
    const material = t(v["Cambio material"]);
    plan.assets.push({
      ref,
      title: entity ?? headline.slice(0, 120),
      kind: kindOf(category, `${entity ?? ""} ${headline}`),
      operation: rental ? "alquiler" : prices.length ? "venta" : "desconocida",
      category,
      locality: location,
      capacityText: capacity,
      surfaceM2: surfaces.covered,
      landM2: surfaces.land,
      occupancy: t(v["Ocupación declarada"]),
      owner: t(v["Propietario"]),
      broker: t(v["Broker / contacto"]),
      operator: t(v["Operador / inquilino"]),
      saleReason: t(v["Motivo de venta"]),
      economics: t(v["Economics disponibles"]),
      firstDetectedOn: day(v["Primera detección"]) ?? day(v["Fecha"]),
      lastCheckedOn: checked,
      materialChange: inconsistent ? `REVISAR: la fila trae superficie «${capacityRaw}» y precio anterior ${previous ?? "—"} que no coinciden con su hallazgo (posible copia de otra fila); no se cargaron. ${material ?? ""}`.trim() : material,
      evidenceLayer: t(v["Capa de evidencia"]),
      priceStatus: !inconsistent && (/inconsistent/i.test(material ?? "") || (!!current && !!previous && current !== previous)) ? "inconsistente" : "sin_validar",
      prices,
    });
  }
  return plan;
}

/**
 * Estado de precio de un activo a partir de su historial: si dos fuentes distintas publican montos distintos
 * en una ventana de 14 días (o sin fecha), es INCONSISTENTE. Nunca se concluye una baja automáticamente.
 */
export function priceStatusOf(history: { amount: number; currency: string; source_url: string | null; observed_on: string | null }[]): "inconsistente" | "sin_validar" {
  for (const a of history)
    for (const b of history) {
      if (a === b || a.currency !== b.currency || a.amount === b.amount) continue;
      if ((a.source_url ?? "") === (b.source_url ?? "") && a.source_url) continue;
      const near = !a.observed_on || !b.observed_on || Math.abs(new Date(a.observed_on).getTime() - new Date(b.observed_on).getTime()) <= 14 * 86_400_000;
      if (near) return "inconsistente";
    }
  return "sin_validar";
}
