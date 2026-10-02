import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { USERS, login } from "./helpers";

// Caso 1 de V13: capturar sin señal y subir una sola vez al volver la conexión.
// El service worker solo se registra en un build de producción:
//   next build && next start -p 3100   (con .env.local)
//   E2E_BASE_URL=http://localhost:3100 E2E_PROD=1 E2E_NET_OFF="..." E2E_NET_ON="..." \
//     npx playwright test sin-senal --project mobile
// E2E_NET_OFF / E2E_NET_ON cortan y restauran la red de verdad (servidor y API locales):
// context.setOffline() de Playwright bloquea la navegación antes del service worker.
const netOff = () => execSync(process.env.E2E_NET_OFF!, { stdio: "inherit" });
const netOn = () => execSync(process.env.E2E_NET_ON!, { stdio: "inherit" });
test.skip(process.env.E2E_PROD !== "1" || !process.env.E2E_NET_OFF, "Requiere build de producción (service worker) y control de red");
test.use({ geolocation: { latitude: -38.354, longitude: -68.79 }, permissions: ["geolocation"] });

test("@mobile abrir RELEVO sin señal, capturar y subir al volver la conexión", async ({ page }) => {
  const note = `Sin señal ${Date.now()}: depósito en el parque industrial`;
  await login(page, USERS.tano);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 30_000 });
  await page.waitForFunction(async () => !!(await (await caches.open("relevo-shell-v1")).match("/offline")), null, { timeout: 30_000 });

  netOff();
  await page.goto("/w/daicou?panel=1");
  await expect(page.getByText("Sin conexión")).toBeVisible();

  await page.getByRole("button", { name: "Capturar" }).click();
  await page.getByPlaceholder("Qué viste").fill(note);
  await expect(page.getByText(/Ubicación GPS/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Pendiente de subir")).toHaveCount(1);

  // Cerrar y reabrir sin señal: la captura sigue en el teléfono.
  await page.reload();
  await expect(page.getByText("Pendiente de subir")).toHaveCount(1);

  netOn();
  await page.goto("/w/daicou/capturas");
  await expect(page.getByText(note)).toHaveCount(1, { timeout: 45_000 });
  await expect(page.getByText("Pendiente de subir")).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByText(/Ubicación GPS.* · sin verificar/).first()).toBeVisible();
});
