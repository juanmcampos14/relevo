import { describe, expect, it } from "vitest";
import { renderMissionBriefEmail, tidyBrief, type MissionBrief } from "./mission-brief";

const item = (o: Partial<MissionBrief["items"][number]>): MissionBrief["items"][number] => ({
  title: "AOG Patagonia es del 19 al 22 de octubre", why_us: "Cambia la agenda del viaje.", moves: ["agenda"], basis: "hecho",
  action: "Mover las reuniones al 20–21.", opportunity: "", connects: [], source_name: "Río Negro", source_url: "https://www.rionegro.com.ar/x", ...o,
});
const brief = (items: MissionBrief["items"]): MissionBrief => ({ opening: "Buenos días, Tano.", quiet: false, items, watching: "", discarded: [] });

describe("Brief de la misión", () => {
  it("muestra como mucho 5 y saca lo que no mueve nada", () => {
    const b = tidyBrief(brief([item({ moves: [] }), ...Array.from({ length: 7 }, (_, i) => item({ title: `t${i}` }))]), new Set());
    expect(b.items.map((x) => x.title)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
  });
  it("si nada mueve algo, dice que hoy no pasó nada relevante", () => {
    const b = tidyBrief(brief([item({ moves: [] })]), new Set());
    expect(b.quiet).toBe(true);
    expect(b.opening).toBe("Hoy no pasó nada relevante para la misión.");
  });
  it("solo refs de la memoria y links http(s)", () => {
    const b = tidyBrief(brief([item({ connects: ["finding:a", "finding:inventada"], source_url: "javascript:alert(1)" })]), new Set(["finding:a"]));
    expect(b.items[0].connects).toEqual(["finding:a"]);
    expect(b.items[0].source_url).toBe("");
  });
  it("el mail lleva tipo de información, por qué importa, acción y fuente clicable", () => {
    const m = renderMissionBriefEmail(brief([item({ title: "<b>x</b>" })]), { mission: "Vaca Muerta", briefDate: "2026-10-03", url: "https://relevo.site/hoy/daicou", test: true });
    expect(m.subject).toMatch(/^\[Prueba\] RELEVO · Vaca Muerta · /);
    expect(m.html).toContain("Hecho");
    expect(m.html).toContain("Por qué importa");
    expect(m.html).toContain('href="https://www.rionegro.com.ar/x"');
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(m.text).toContain("Qué haría: Mover las reuniones al 20–21.");
  });
});
