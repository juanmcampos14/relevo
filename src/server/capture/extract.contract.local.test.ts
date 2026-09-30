// Contrato con la API real (cuesta ~USD 0,05): RUN_CONTRACT=1 npx vitest run src/server/capture/extract.contract.local.test.ts
// Los tests del pipeline usan un cliente simulado; esto confirma que la API acepta el esquema
// (el 400 "compiled grammar is too large" de captura-v3 solo aparece contra la API real).
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractCapture } from "./extract";

const run = process.env.RUN_CONTRACT === "1" && !!process.env.ANTHROPIC_API_KEY;
if (run) mkdirSync(".scratch", { recursive: true });

describe.skipIf(!run)("extracción contra la API real", () => {
  it("dictado de un local: acepta el esquema y separa lo observado de lo declarado", async () => {
    const res = await extractCapture(new Anthropic(), {
      capturedAt: "2026-10-16T15:00:00-03:00",
      capturedBy: "Tano",
      missionName: "Añelo",
      location: "-38.35, -68.79",
      body: "[Audio 1, 0:20, transcripción automática]\nAcabo de ver un local a mitad de cuadra de la gomería, tiene 60 metros cuadrados según el cartel, da contra la calle y tiene una terraza donde se pueden poner sillas afuera. Estaba cerrado.",
      photos: [],
      companies: [{ id: "c1", name: "Gomería del Centro", locality: "Añelo" }],
      contacts: [],
      findings: [{ id: "f1", statement: "Faltan locales comerciales con frente a la calle en Añelo" }],
      unresolved: [],
    });
    if (!res.ok) throw new Error(res.error);
    const x = res.extraction;
    expect(x.asset).not.toBeNull();
    expect(x.evidence.length).toBeGreaterThan(0);
    // "" nunca llega a RELEVO: vuelve como null.
    for (const e of x.evidence) for (const v of [e.quote, e.stated_by, e.declared_by]) expect(v).not.toBe("");
  }, 180_000);
});

describe.skipIf(!run)("capturas 3 y 4 de la prueba E contra la API real", () => {
  const ctx = {
    capturedAt: "2026-10-17T13:00:00-03:00", capturedBy: "Tano", missionName: "Añelo", location: null, photos: [],
    companies: [], contacts: [],
    findings: [{ id: "f1", statement: "Los trabajadores que circulan por la ruta tienen dificultad para encontrar dónde comer" }],
    unresolved: [] as { id: string; kind: "organization" | "actor"; label: string }[],
  };

  it("contraevidencia: se relaciona con la hipótesis existente (no crea una contrapuesta)", async () => {
    const res = await extractCapture(new Anthropic(), { ...ctx, body: "[Audio 1, 0:15, transcripción automática]\nHablé con un chofer de una empresa de servicios petroleros. Me dijo que no tiene ese problema porque su empresa le da vianda todos los días." });
    if (!res.ok) throw new Error(res.error);
    const f = res.extraction.finding_candidates;
    writeFileSync(".scratch/contract-3.json", JSON.stringify(res.extraction, null, 1));
    expect(f.some((c) => c.existing_finding_id === "f1" && c.relation !== "nueva")).toBe(true);
    expect(f.some((c) => c.existing_finding_id === null && c.relation === "nueva" && /no.*(problema|dificultad)/i.test(c.statement))).toBe(false);
    expect(res.extraction.people.every((p) => !p.name)).toBe(true);
  }, 180_000);

  it("economía con una contratista sin nombre: organización sin identificar y qué falta saber", async () => {
    const res = await extractCapture(new Anthropic(), { ...ctx, body: "[Audio 1, 0:25, transcripción automática]\nHablé con el encargado de una contratista. Trabajan unas 35 personas en la zona. Cuando no tienen vianda contratada reintegran hasta 18.000 pesos por comida. Evaluarían un proveedor cercano si factura a la empresa, entrega rápido y entra en ese presupuesto." });
    if (!res.ok) throw new Error(res.error);
    writeFileSync(".scratch/contract-4.json", JSON.stringify(res.extraction, null, 1));
    expect(res.extraction.company?.identified).toBe(false);
    expect(res.extraction.unknowns.length).toBeGreaterThan(0);
    expect(res.extraction.evidence.some((e) => /18\.?000/.test(e.statement))).toBe(true);
  }, 180_000);
});
