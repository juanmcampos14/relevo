import type { Metadata } from "next";
import { OfflineCapture } from "./offline-capture";

export const metadata: Metadata = { title: "Sin señal" };

// Página sin datos del servidor: el service worker la guarda y la entrega cuando no hay red.
export default function OfflinePage() {
  return <OfflineCapture />;
}
