import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Versión del deploy para avisar a páginas abiertas desde antes (ver VersionWatcher).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
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
