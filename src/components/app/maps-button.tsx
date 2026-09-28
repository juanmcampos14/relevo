import { MapPin, TriangleAlert } from "lucide-react";
import { directionsLink, type Place } from "@/domain/maps";

/** Abre Google Maps con destino. Avisa si la dirección no está verificada; sin dirección no fabrica ruta. */
export function MapsButton({ place, compact = false }: { place: Place | null; compact?: boolean }) {
  if (!place) return null;
  const link = directionsLink(place);
  if (link.kind === "none") {
    return compact ? null : <span className="text-xs text-muted-foreground">{link.reason}: no se puede navegar</span>;
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.verified ? "Abrir en Google Maps" : "Dirección no verificada: revisá el destino en Maps"}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
    >
      {link.verified ? <MapPin className="size-4 text-primary" /> : <TriangleAlert className="size-4 text-amber-600" />}
      {compact ? "Maps" : link.verified ? "Abrir en Google Maps" : "Abrir en Maps (dirección sin verificar)"}
    </a>
  );
}
