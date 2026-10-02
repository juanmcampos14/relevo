import { describe, expect, it } from "vitest";
import { evidenceAuthor } from "./evidence-author";

describe("autor de la evidencia", () => {
  it("persona, planilla, investigación de RELEVO o sin autor (nunca inventado)", () => {
    expect(evidenceAuthor("Fran", "field")).toBe("Fran");
    expect(evidenceAuthor("Tano", "crm_import")).toBe("Tano (planilla)");
    expect(evidenceAuthor(null, "website")).toBe("RELEVO (investigación)");
    expect(evidenceAuthor(null, "aog")).toBe("RELEVO (investigación)");
    expect(evidenceAuthor(null, "conversation")).toBe("sin autor registrado");
  });
});
