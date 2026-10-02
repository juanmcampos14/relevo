import type { MetadataRoute } from "next";

// App instalable: en el iPhone, "Compartir → Agregar a pantalla de inicio".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RELEVO OS",
    short_name: "RELEVO",
    description: "Originación e investigación de oportunidades de negocio",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf7f0",
    theme_color: "#c24f2b",
    lang: "es",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" }],
  };
}
