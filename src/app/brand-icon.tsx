import { ImageResponse } from "next/og";

// Ícono de RELEVO (favicon y app instalada): las montañas del logo. El favicon va sin fondo; el de la
// pantalla de inicio, sobre el crema de la marca. Colores en hex: el renderizador no entiende oklch.
export function brandIcon(size: number, opts: { background?: string } = {}) {
  const pad = opts.background ? 0.16 : 0.02;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: opts.background ?? "transparent" }}>
        <svg viewBox="608 232 384 184" width={size * (1 - pad * 2)} height={size * (1 - pad * 2) * (184 / 384)}>
          <path d="M617 408 L736 240 L793 320 L728 408 Z" fill="#5B6B4E" />
          <path d="M866 240 L983 408 L872 408 L808 320 Z" fill="#C9744F" />
          <path d="M743 408 L800 328 L857 408 Z" fill="#E6CDB5" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
