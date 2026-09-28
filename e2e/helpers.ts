import { expect, type Page } from "@playwright/test";

// Usuarios SOLO locales definidos en supabase/seed.sql.
export const PASSWORD = "relevo-local-2026";
export const USERS = { tano: "tano@relevo.local", fran: "fran@relevo.local", visor: "visor@relevo.local" };

export async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login?next=/w/daicou");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/w/daicou");
}

export async function openDetails(page: Page, summary: string | RegExp) {
  const s = page.locator("summary", { hasText: summary }).first();
  const details = s.locator("xpath=..");
  if ((await details.getAttribute("open")) === null) await s.click();
  await expect(details).toHaveAttribute("open", "");
  return details;
}

export async function toast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]", { hasText: text }).first()).toBeVisible();
  // Esperar a que termine la revalidación de la página antes del siguiente paso.
  await page.waitForLoadState("networkidle");
}
