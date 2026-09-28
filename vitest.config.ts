import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

const pick = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([k, v]) => /SUPABASE|SITE_URL|TEST_DATABASE_URL/.test(k) && v)) as Record<string, string>;

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
    // En CI las variables vienen del entorno (GITHUB_ENV); tienen prioridad sobre el archivo.
    env: { ...loadEnv(mode, process.cwd(), ""), ...pick(process.env) },
    // Las pruebas de DB comparten el Postgres local: sin paralelismo entre archivos.
    fileParallelism: false,
  },
}));
