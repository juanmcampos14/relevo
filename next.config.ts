import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Fotos de Unsplash (licencia libre) servidas por el optimizador de Next.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-**" }],
  },
};

export default nextConfig;
