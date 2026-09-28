import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" lanza fuera de React Server Components; en pruebas es inocuo.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    // .env.local (Supabase local) para las pruebas que usan supabase-js.
    env: loadEnv(mode, process.cwd(), ""),
    // Las pruebas de DB comparten el Postgres local: sin paralelismo entre archivos.
    fileParallelism: false,
  },
}));
