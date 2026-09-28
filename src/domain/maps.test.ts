import { describe, expect, it } from "vitest";
import { directionsLink, multiStopLink, searchLink, type Place } from "./maps";

const base: Place = {
  address_text: "Ruta Provincial 7 km 3",
  locality: "Añelo",
  province: "Neuquén",
  country: "Argentina",
  address_status: "no_verificada",
  latitude: null,
  longitude: null,
};

describe("enlaces de Google Maps", () => {
  it("codifica la dirección y la marca como no verificada", () => {
    const link = directionsLink(base);
    expect(link.kind).toBe("ok");
    if (link.kind !== "ok") return;
    expect(link.verified).toBe(false);
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe("Ruta Provincial 7 km 3, Añelo, Neuquén, Argentina");
  });

  it("usa coordenadas solo cuando la ubicación está verificada", () => {
    const link = searchLink({ ...base, address_status: "verificada", latitude: -38.354, longitude: -68.788 });
    expect(link.kind === "ok" && new URL(link.url).searchParams.get("query")).toBe("-38.354,-68.788");
    expect(link.kind === "ok" && link.verified).toBe(true);
  });

  it("sin dirección no fabrica ningún destino", () => {
    expect(directionsLink({ ...base, address_text: null, address_status: "sin_direccion" })).toEqual({
      kind: "none",
      reason: "Sin dirección registrada",
    });
  });

  it("multi-parada respeta el orden manual y omite paradas sin dirección", () => {
    const a = { ...base, address_text: "A 1" };
    const b = { ...base, address_text: null, address_status: "sin_direccion" as const };
    const c = { ...base, address_text: "C 3" };
    const link = multiStopLink([a, b, c]);
    expect(link.kind).toBe("ok");
    if (link.kind !== "ok") return;
    const url = new URL(link.url);
    expect(url.searchParams.get("waypoints")).toBe("A 1, Añelo, Neuquén, Argentina");
    expect(url.searchParams.get("destination")).toBe("C 3, Añelo, Neuquén, Argentina");
    expect(link.skipped).toBe(1);
    expect(link.unverifiedCount).toBe(2);
  });

  it("no genera multi-parada por encima del límite móvil", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...base, address_text: `Calle ${i}` }));
    expect(multiStopLink(five).kind).toBe("none");
  });
});
