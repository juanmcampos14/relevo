import { expect, test } from "@playwright/test";
import { USERS, login } from "./helpers";
// Recorrido de producto: observación de campo → ubicación → señal → investigación (memoria + territorio + web) → hipótesis → nueva evidencia.
test.use({ geolocation: { latitude: -38.3545, longitude: -68.7880 }, permissions: ["geolocation"] });
// Usa Claude y la web reales (cuesta ~USD 1): RUN_CONTRACT=1 npx playwright test e2e/discovery-ferreteria.spec.ts
test("una observación de campo se investiga (memoria + territorio + web), se guarda como señal y la evidencia nueva refina la hipótesis", async ({ page }) => {
  test.skip(process.env.RUN_CONTRACT !== "1", "Prueba de producto con la API real");
  test.setTimeout(900_000);
  await login(page, USERS.tano);
  await page.getByRole("button", { name: "Preguntar a RELEVO" }).click();
  await page.getByRole("button", { name: "Nueva" }).click();
  const box = page.getByRole("textbox", { name: "Pregunta", exact: true });
  const ask = async (q: string, shot: string) => {
    await box.fill(q);
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Consultando la memoria…")).toBeVisible();
    await expect(page.getByText("Consultando la memoria…")).toBeHidden({ timeout: 400_000 });
    const text = await page.locator("[role=dialog]").innerText();
    require("node:fs").mkdirSync(".scratch", { recursive: true });
    require("node:fs").writeFileSync(`.scratch/${shot}.txt`, text);
    await page.screenshot({ path: `.scratch/${shot}.png`, fullPage: false });
  };
  await ask("Hoy caminé cinco horas por Añelo y vi una sola ferretería. Me llamó la atención. ¿Puede haber una oportunidad acá? Investigá cuántas ferreterías hay realmente en Añelo, cómo funciona el negocio, qué demanda podría existir y ayudame a entender si vale la pena seguir investigándolo.", "ferre-1");
  const approve = page.getByRole("button", { name: /^Aprobar/ }).first();
  if (await approve.count()) { await approve.click(); await page.waitForTimeout(8000); }
  await page.screenshot({ path: ".scratch/ferre-2.png" });
  expect(await page.locator("[role=dialog]").innerText()).toMatch(/Guardé tu nota/i);
  await ask("Entré a una ferretería y hablé con el dueño. Me dijo que lo que más vende es tornillería y ropa de trabajo, y que mucha gente se va a Neuquén a comprar repuestos hidráulicos y mangueras de alta presión porque él no consigue stock.", "ferre-3");
  // La nota nueva se relaciona con la hipótesis abierta (la acota o la apoya) en vez de abrir otra.
  expect(await page.locator("[role=dialog]").innerText()).toMatch(/Reformula|hipótesis existente|acota/i);
});
