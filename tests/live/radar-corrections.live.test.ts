// Correcciones de Tano (01/10) a dos activos del Radar, bloqueadas contra la reimportación del Sheet.
// RAD-ACT-03 La Meseta: USD 115.000 actual, USD 127.000 anterior; 38 m²; 2 dormitorios; 4 camas.
// RAD-ACT-04 complejo de 7 departamentos: USD 750.000 (Leo Sfeir) y USD 810.000 (ficha equivalente) =
// PRECIO INCONSISTENTE (nunca una baja calculada); 450 m² cubiertos, 900 m² terreno, 7 unidades, 26 plazas.
// FIX=1 WORKSPACE=<id> npx vitest run tests/live/radar-corrections.live.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

describe.skipIf(!process.env.FIX || !process.env.WORKSPACE)("correcciones del Radar", () => {
  it("RAD-ACT-03 y RAD-ACT-04", async () => {
    const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const ws = process.env.WORKSPACE!;
    const asset = async (ref: string) => (await db.from("assets").select("id").eq("workspace_id", ws).eq("radar_ref", ref).single()).data!.id;
    const addPrice = async (assetId: string, ref: string, amount: number, note: string, observed_on: string | null) => {
      const { data } = await db.from("asset_prices").select("id").eq("asset_id", assetId).eq("amount", amount).eq("currency", "USD");
      if (data?.length) return;
      const { error } = await db.from("asset_prices").insert({ workspace_id: ws, asset_id: assetId, amount, currency: "USD", operation: "venta", observed_on, basis: "declarado", origin: "manual", external_ref: ref, note });
      expect(error).toBeNull();
    };

    const a3 = await asset("RAD-ACT-03");
    await addPrice(a3, "RAD-ACT-03", 127000, "Precio anterior (corrección de Tano, 01/10). Fecha y fuente de la publicación anterior sin registrar.", null);
    const fix3 = {
      surface_m2: 38, land_m2: null, capacity_text: "38 m² · 2 dormitorios · 4 camas", price_status: "vigente",
      material_change: "Corregido el 01/10 (Tano): USD 115.000 actual, USD 127.000 anterior; 38 m², 2 dormitorios, 4 camas. La fila del Sheet traía datos de RAD-ACT-04.",
      locked_fields: ["surface_m2", "land_m2", "capacity_text", "material_change", "price_status"],
    };
    expect((await db.from("assets").update(fix3).eq("id", a3)).error).toBeNull();

    const a4 = await asset("RAD-ACT-04");
    await db.from("asset_prices").update({ publisher: "Leo Sfeir y Asociados" }).eq("asset_id", a4).eq("amount", 750000);
    await addPrice(a4, "RAD-ACT-04", 810000, "Ficha equivalente detectada (otra publicación del mismo complejo). Distinto de USD 750.000 de Leo Sfeir: PRECIO INCONSISTENTE, no es una baja.", "2026-10-01");
    const fix4 = {
      surface_m2: 450, land_m2: 900, capacity_text: "450 m² cubiertos · 900 m² terreno · 7 unidades · 26 plazas", price_status: "inconsistente",
      material_change: "Corregido el 01/10 (Tano): USD 750.000 (Leo Sfeir) y USD 810.000 (ficha equivalente) = PRECIO INCONSISTENTE; no se calcula reducción.",
      locked_fields: ["surface_m2", "land_m2", "capacity_text", "material_change", "price_status"],
    };
    expect((await db.from("assets").update(fix4).eq("id", a4)).error).toBeNull();

    const { data } = await db.from("assets").select("radar_ref, surface_m2, capacity_text, price_status, asset_prices(amount)").in("id", [a3, a4]).order("radar_ref");
    expect(data!.map((x) => [x.radar_ref, x.price_status, x.asset_prices.map((p) => Number(p.amount)).sort()])).toEqual([
      ["RAD-ACT-03", "vigente", [115000, 127000]],
      ["RAD-ACT-04", "inconsistente", [750000, 810000]],
    ]);
  });
});
