// Contrato con la API real (cuesta ~USD 0,05): RUN_CONTRACT=1 npx vitest run src/server/capture/extract.contract.local.test.ts
// Los tests del pipeline usan un cliente simulado; esto confirma que la API acepta el esquema
// (el 400 "compiled grammar is too large" de captura-v3 solo aparece contra la API real).
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { extractCapture } from "./extract";

const run = process.env.RUN_CONTRACT === "1" && !!process.env.ANTHROPIC_API_KEY;

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
    });
    if (!res.ok) throw new Error(res.error);
    const x = res.extraction;
    expect(x.asset).not.toBeNull();
    expect(x.evidence.length).toBeGreaterThan(0);
    // "" nunca llega a RELEVO: vuelve como null.
    for (const e of x.evidence) for (const v of [e.quote, e.stated_by, e.declared_by]) expect(v).not.toBe("");
  }, 180_000);
});
