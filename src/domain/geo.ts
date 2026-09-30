// Territorio sin dependencias: distancias y radios (Añelo como referencia por defecto).
export type Point = { lat: number; lng: number };
export const ANELO: Point = { lat: -38.3539, lng: -68.7883 };

/** Distancia en metros (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace(".", ",")} km`;
}

/** Caja que contiene un círculo (para filtrar en la base antes de medir). */
export function bbox(c: Point, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((c.lat * Math.PI) / 180));
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLng: c.lng - dLng, maxLng: c.lng + dLng };
}

/** Categorías de lugares que RELEVO sabe buscar en el territorio (etiquetas de OpenStreetMap). */
export const PLACE_CATEGORIES = {
  ferreteria: { label: "Ferreterías", osm: [["shop", "hardware"], ["shop", "doityourself"]] },
  corralon: { label: "Corralones y materiales", osm: [["shop", "trade"], ["shop", "building_materials"], ["trade", "building_supplies"]] },
  electricidad: { label: "Electricidad", osm: [["shop", "electrical"], ["shop", "lighting"]] },
  sanitarios: { label: "Sanitarios", osm: [["shop", "bathroom_furnishing"], ["trade", "plumbing"]] },
  seguridad_industrial: { label: "Seguridad industrial", osm: [["shop", "safety_equipment"], ["shop", "workwear"]] },
  alojamiento: { label: "Alojamiento", osm: [["tourism", "hotel"], ["tourism", "motel"], ["tourism", "guest_house"], ["tourism", "hostel"], ["tourism", "apartment"]] },
  gastronomia: { label: "Gastronomía", osm: [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "cafe"]] },
  gimnasio: { label: "Gimnasios", osm: [["leisure", "fitness_centre"], ["leisure", "sports_centre"]] },
  lavadero: { label: "Lavaderos de vehículos", osm: [["amenity", "car_wash"]] },
  combustible: { label: "Estaciones de servicio", osm: [["amenity", "fuel"]] },
  supermercado: { label: "Supermercados y almacenes", osm: [["shop", "supermarket"], ["shop", "convenience"]] },
  taller: { label: "Talleres mecánicos", osm: [["shop", "car_repair"], ["craft", "mechanic"]] },
  industria: { label: "Industria y logística", osm: [["landuse", "industrial"], ["building", "warehouse"], ["man_made", "works"]] },
} as const;
export type PlaceCategory = keyof typeof PLACE_CATEGORIES;
export const PLACE_CATEGORY_KEYS = Object.keys(PLACE_CATEGORIES) as [PlaceCategory, ...PlaceCategory[]];
