import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/build";

// La versión publicada. Una página abierta desde antes compara contra esto y ofrece actualizar:
// con la protección de versiones de Vercel, una página vieja sigue hablando con el deploy viejo.
export function GET() {
  return NextResponse.json({ id: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
