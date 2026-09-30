import { describe, expect, it } from "vitest";
import { ANELO, bbox, distanceM, formatDistance } from "./geo";

describe("territorio", () => {
  it("distancias y radios", () => {
    const neuquen = { lat: -38.9516, lng: -68.0591 };
    expect(Math.round(distanceM(ANELO, neuquen) / 1000)).toBe(92);
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(4230)).toBe("4,2 km");
    const b = bbox(ANELO, 5000);
    expect(b.maxLat - b.minLat).toBeCloseTo(0.0898, 3);
  });
});
