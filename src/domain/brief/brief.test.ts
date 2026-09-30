import { describe, expect, it } from "vitest";
import { parseVmnArticle, parseVmnHome } from "./sources";
import { briefDateAR, briefPeriod, changesOf, matchCompanies, verticalRadar } from "./derive";
import { renderBriefEmail } from "./render";
import type { BriefContent, BriefSignalView } from "./contract";

const HOME = `<a href="/actualidad/chevron-invertira-us-13800.htm">x</a><a href="/actualidad/chevron-invertira-us-13800.htm">x</a>
<a href="/actualidad/nueva-edicion-de-vaca-muerta-news-radio-20.htm">radio</a><a href="/energia/obra-ruta-7.htm">y</a><a href="/tag/ypf">tag</a>`;
const ARTICLE = `<html><head><meta property="og:title" content="Horacio Mar&iacute;n: la estaci&oacute;n de YPF que m&aacute;s vende es la de A&ntilde;elo"/>
<meta property="og:description" content="Bajada &amp; contexto"/><meta property="article:published_time" content="2026-09-28T11:17:52-03:00"/></head>
<body><div class="bloque bloque-cuerpo"><p>Primer párrafo con <b>negrita</b>.</p><p>Segundo &quot;párrafo&quot;.</p></div><div class="etiquetas-nota"><p>no</p></div></body></html>`;

describe("Vaca Muerta News", () => {
  it("portada: notas únicas, sin radio ni tags", () => {
    expect(parseVmnHome(HOME)).toEqual(["https://www.vacamuertanews.com/actualidad/chevron-invertira-us-13800.htm", "https://www.vacamuertanews.com/energia/obra-ruta-7.htm"]);
  });
  it("nota: título, fecha y cuerpo sin etiquetas", () => {
    const a = parseVmnArticle(ARTICLE.replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&aacute;/g, "á").replace(/&ntilde;/g, "ñ"), "https://x.test/a.htm")!;
    expect(a.title).toBe("Horacio Marín: la estación de YPF que más vende es la de Añelo");
    expect(a.publishedAt).toBe("2026-09-28T14:17:52.000Z");
    expect(a.description).toBe("Bajada & contexto");
    expect(a.body).toBe('Primer párrafo con negrita .\nSegundo "párrafo".');
  });
});

const sig = (o: Partial<BriefSignalView>): BriefSignalView => ({
  id: "s", key: "s1", headline: "H", summary: "S", happened_on: "", source_url: "", source_title: "", publisher: "", basis: "hecho", signal_type: "obra",
  section: "general", geography: "", vertical: "Logística + almacenamiento", subsector: "", roles: [], companies: [], people: [], why_it_matters: "", reading: "",
  change: "nuevo", relevance: "media", suggested_action: "", verify: "", talk_to: "", ask: "", story_id: null, story_title: null, company_ids: [], finding_ids: [], ...o,
});

describe("cruces y secciones derivadas", () => {
  it("empresas de la memoria como palabra completa (sin tildes, sin nombres cortos)", () => {
    const companies = [{ id: "a", name: "PECOM" }, { id: "b", name: "Añelo Tours" }, { id: "c", name: "YPF" }, { id: "d", name: "Hidroil" }];
    expect(matchCompanies(["Pecom contrató a ANELO TOURS", "Hidroilera nueva"], companies)).toEqual(["a", "b"]);
  });
  it("radar por vertical y qué cambió", () => {
    const s = [sig({ key: "a", companies: ["X"], finding_ids: ["f"] }), sig({ key: "b", change: "contradicho", companies: ["X", "Y"] }), sig({ key: "c", vertical: "Comercio cotidiano", change: "actualizado" })];
    const r = verticalRadar(s, [{ question: "¿Aumentó el volumen?", vertical: "Gomerías + neumáticos" }]);
    expect(r[0]).toMatchObject({ vertical: "Logística + almacenamiento", signals: 2, contradictions: 1, companies: ["X", "Y"], hypotheses: 1 });
    expect(r.find((x) => x.vertical === "Gomerías + neumáticos")).toMatchObject({ signals: 0, questions: ["¿Aumentó el volumen?"] });
    const ch = changesOf(s);
    expect(ch.nuevo.map((x) => x.key)).toEqual(["a"]);
    expect(ch.contradicho.map((x) => x.key)).toEqual(["b"]);
  });
  it("período: desde el último brief; 36 h si es el primero; lunes cubre el fin de semana", () => {
    const now = new Date("2026-10-19T08:00:00Z");
    expect(briefPeriod(now, null).start.toISOString()).toBe("2026-10-17T20:00:00.000Z");
    expect(briefPeriod(now, new Date("2026-10-16T08:30:00Z")).start.toISOString()).toBe("2026-10-16T08:30:00.000Z");
    expect(briefDateAR(new Date("2026-10-19T02:00:00Z"))).toBe("2026-10-18");
  });
});

describe("email", () => {
  const content: BriefContent = {
    headline_points: [{ text: "Chevron acelera El Trapial <b>", signal_keys: ["s1"] }], signals: [sig({ headline: "Obra <script>", source_url: "https://x.test/n", publisher: "VMN", reading: "Más camiones" })],
    connections: [], actions: [{ title: "Hablar con gomerías", why: "Más flota", signal_keys: [] }], field_questions: [{ question: "¿Aumentó?", vertical: "Gomerías + neumáticos", why: "" }],
    watchlist: [], candidates: [], vertical_radar: [], changes: changesOf([]), sources: [], quiet_day_note: "",
  };
  it("mismo objeto → asunto, HTML escapado y texto, con el brief_id", () => {
    const e = renderBriefEmail(content, { briefId: "b-1", briefDate: "2026-10-16", workspaceName: "Daicou", url: "https://relevo.test/w/d/brief/b-1" });
    expect(e.subject).toMatch(/^RELEVO · Morning Brief .*16 de octubre — Chevron acelera El Trapial <b>$/);
    expect(e.html).toContain("Obra &lt;script&gt;");
    expect(e.html).not.toContain("<script>");
    for (const t of ["01 — Lo que importa hoy", "09 — Qué haría RELEVO hoy", "11 — Preguntas para campo", "12 — Watchlist", "brief b-1"]) expect(e.html).toContain(t);
    expect(e.text).toContain("Lectura RELEVO (inferencia): Más camiones");
  });
});
