import { describe, expect, it } from "vitest";
import { isStale, knowledgeGroup, revalidateAfter } from "./evidence";

describe("evidencia", () => {
  it("revalidar a los 30 días (default P0)", () => {
    expect(revalidateAfter("2026-09-29T15:00:00Z", "capacidad")).toBe("2026-10-29");
  });

  it("desactualizada por fecha o por decisión humana", () => {
    expect(isStale({ verification_status: "publicly_verified", revalidate_after: "2026-10-01" }, "2026-10-02")).toBe(true);
    expect(isStale({ verification_status: "stale", revalidate_after: null }, "2026-10-02")).toBe(true);
    expect(isStale({ verification_status: "field_verified", revalidate_after: "2026-11-01" }, "2026-10-02")).toBe(false);
  });

  it("sabemos / creemos / en duda", () => {
    const today = "2026-10-02";
    expect(knowledgeGroup({ verification_status: "field_verified", revalidate_after: null }, today)).toBe("sabemos");
    expect(knowledgeGroup({ verification_status: "partially_verified", revalidate_after: null }, today)).toBe("creemos");
    expect(knowledgeGroup({ verification_status: "unverified", revalidate_after: null }, today)).toBe("creemos");
    expect(knowledgeGroup({ verification_status: "contradicted", revalidate_after: null }, today)).toBe("en_duda");
    expect(knowledgeGroup({ verification_status: "publicly_verified", revalidate_after: "2026-09-01" }, today)).toBe("en_duda");
  });
});
