// Verticales del mapa de investigación con código estable (V01…). El código no cambia aunque cambie
// la etiqueta: reetiquetar no pierde historia. Fuente: presentación "16 verticales" (misma numeración
// que H-VA-01…16). V17 es provisoria hasta cerrar la taxonomía (docs/07-taxonomia.md).

export type VerticalDef = { code: string; name: string; provisional?: boolean; aliases?: string[] };

export const VERTICALS: VerticalDef[] = [
  { code: "V01", name: "Viandas / restaurantes / catering", aliases: ["Viandas / catering", "Gastronomía / viandas", "Gastronomía"] },
  { code: "V02", name: "Ferreterías + suministros industriales", aliases: ["Suministros industriales", "Abastecimiento industrial / MRO"] },
  { code: "V03", name: "Farmacias + salud cotidiana", aliases: ["Farmacias + salud", "Farmacias / salud"] },
  { code: "V04", name: "Gomerías + neumáticos", aliases: ["Gomerías / neumáticos"] },
  { code: "V05", name: "Lavaderos de vehículos" },
  { code: "V06", name: "Estaciones de servicio" },
  { code: "V07", name: "Lavanderías industriales + textiles", aliases: ["Lavandería industrial"] },
  { code: "V08", name: "Limpieza + facility management", aliases: ["Limpieza + facility"] },
  { code: "V09", name: "Alojamiento + campamentos", aliases: ["Alojamiento"] },
  { code: "V10", name: "Repuestos / talleres / lubricentros", aliases: ["Repuestos / talleres"] },
  { code: "V11", name: "Logística / almacenamiento / última milla", aliases: ["Logística + almacenamiento", "Logística"] },
  { code: "V12", name: "Comercio cotidiano", aliases: ["Comercios"] },
  { code: "V13", name: "Servicios para trabajadores + familias", aliases: ["Trabajadores + familias", "Servicios a trabajadores y familias", "Fitness"] },
  { code: "V14", name: "Construcción + mantenimiento", aliases: ["Construcción e infraestructura"] },
  { code: "V15", name: "Servicios industriales especializados", aliases: ["Servicios industriales"] },
  { code: "V16", name: "Software + automatización B2B", aliases: ["Software + automatización"] },
  { code: "V17", name: "Inmuebles, activos y fondos de comercio", provisional: true, aliases: ["Inmuebles / activos / fondos de comercio", "Inmuebles y tierra", "Fondos de comercio"] },
];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const BY_LABEL = new Map(VERTICALS.flatMap((v) => [v.name, ...(v.aliases ?? [])].map((l) => [fold(l), v] as const)));

/** Vertical por etiqueta exacta o alias conocido; si no, null (texto libre nunca crea una vertical). */
export function verticalByLabel(label: string | null | undefined): VerticalDef | null {
  return label ? BY_LABEL.get(fold(label)) ?? null : null;
}
