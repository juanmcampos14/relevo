import { describe, expect, it } from "vitest";
import { hostOf, mapsUrl } from "./links";

describe("links clicables", () => {
  it("Maps por coordenadas o por dirección; sin datos, nada", () => {
    expect(mapsUrl({ lat: -38.35, lng: -68.79 })).toBe("https://www.google.com/maps/search/?api=1&query=-38.35,-68.79");
    expect(mapsUrl({ address: "Familia Chávez 60", locality: "Añelo" })).toBe("https://www.google.com/maps/search/?api=1&query=Familia%20Ch%C3%A1vez%2060%2C%20A%C3%B1elo");
    expect(mapsUrl({})).toBeNull();
  });
  it("la fuente se nombra por su sitio", () => {
    expect(hostOf("https://www.linkedin.com/in/juan-perez")).toBe("linkedin.com");
  });
});
