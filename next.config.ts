import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // El .xlsx del CRM se sube por Server Action (hoy ~0,6 MB). Vercel corta en 4,5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  images: {
    // Fotos de Unsplash (licencia libre) servidas por el optimizador de Next.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-**" }],
  },
};

export default nextConfig;
