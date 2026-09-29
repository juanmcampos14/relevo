import { ImageResponse } from "next/og";

// Ícono de la app instalada (PWA / pantalla de inicio): bardas sobre el horizonte.
// Colores en hex: el renderizador de imágenes no entiende oklch.
export function brandIcon(size: number) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#c24f2b" }}>
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <path d="M4 22 L10 14 L14 18 L19 10 L28 22 Z" fill="#fbf7f0" />
          <rect x="4" y="23.5" width="24" height="2" rx="1" fill="#fbf7f0" opacity="0.6" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
