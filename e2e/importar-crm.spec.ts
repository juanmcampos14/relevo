import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { USERS, login, toast } from "./helpers";

// Importador del CRM desde la interfaz. Por defecto usa un .xlsx sintético con la estructura del CRM real.
// Con CRM_XLSX=/ruta/al/export.xlsx y CRM_IDS=AN-0023,AN-0054,AN-0029 corre el piloto con el archivo real (solo local).

async function syntheticWorkbook(tag: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, header: string[], rows: (string | null)[][], preamble = 0) => {
    const ws = wb.addWorksheet(name);
    for (let i = 0; i < preamble; i++) ws.addRow([i === 0 ? name : ""]);
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(r));
  };
  sheet("EMPRESAS", ["ID anterior", "ID", "Empresa / establecimiento", "Sector", "Subsector", "Localidad / zona", "Dirección", "Teléfono público", "Sitio oficial", "Prioridad", "Etapa CRM", "Estado de evidencia", "Fuente ID", "Responsable", "Próxima acción", "Fecha próxima acción", "Notas"], [
    [`AN-${tag}1`, `AN-${tag}1`, `Hotel E2E ${tag}`, "Alojamiento", "Hotel + viandas", "Añelo", "RP7 y RP17", null, "https://hotel-e2e.example", "Alta", "Investigación", "Fuente pública pendiente revalidación", `SRC-${tag}1`, "Tano", "Identificar decisor", "05/10/2026", "Nota del CRM"],
  ], 3);
  sheet("RED | CONTACTOS", ["ID", "Nombre", "Empresa ID", "Empresa", "Cargo", "Acceso / vínculo", "Correo", "Teléfono", "Fuente / referencia", "Estado de relación", "Responsable"], [
    [`CT-${tag}1`, "Administración (cargo; persona por identificar)", `AN-${tag}1`, `Hotel E2E ${tag}`, "Administración", "Buzón institucional", `admin-${tag}@hotel.example`, null, `SRC-${tag}1`, "Por contactar", "Tano"],
  ], 3);
  sheet("ACTIVIDADES", ["ID", "Empresa ID", "Contacto ID", "Oportunidad ID", "Tipo", "Actividad / objetivo", "Responsable", "Vencimiento", "Estado", "Canal"], [
    [`ACT-${tag}1`, `AN-${tag}1`, `CT-${tag}1`, null, "Correo", `Solicitar reunión ${tag}`, "Tano", "2026-10-02", "Pendiente", "Gmail"],
  ]);
  sheet("FUENTES", ["ID", "Entidad vinculada", "Tipo", "Título / evidencia", "URL original", "Fecha consulta", "Calidad", "Hecho que sustenta", "Limitaciones"], [
    [`SRC-${tag}1`, `AN-${tag}1`, "Directorio de negocios", `Hotel E2E ${tag}, ficha pública`, `https://maps.example/${tag}`, "2026-09-27", "Media", "Existencia, categoría y teléfono", "Comprobar in situ"],
  ]);
  const file = join(mkdtempSync(join(tmpdir(), "crm-")), "crm.xlsx");
  await wb.xlsx.writeFile(file);
  return file;
}

test("importar el CRM: revisar, aprobar, escribir, abrir la ficha y reimportar sin duplicar", async ({ page }) => {
  test.setTimeout(180_000);
  const tag = String(Date.now()).slice(-5);
  const file = process.env.CRM_XLSX ?? (await syntheticWorkbook(tag));
  const ids = process.env.CRM_IDS ?? "";

  await login(page, USERS.tano);
  await page.goto("/w/daicou/integraciones");
  await page.locator('input[type="file"][name="file"]').setInputFiles(file);
  if (ids) await page.getByLabel("Solo estas empresas (opcional)").fill(ids);
  await page.getByRole("button", { name: "Analizar archivo" }).click();
  await page.waitForURL(/\/integraciones\/importar\//);
  await expect(page.getByRole("heading", { name: "Revisar importación del CRM" })).toBeVisible();

  // Filas con propuestas a decidir: se aplica la propuesta y se aprueba.
  for (;;) {
    const card = page.locator("li", { has: page.getByRole("button", { name: "Aprobar" }) }).first();
    if (!(await card.count())) break;
    const radios = card.locator('input[type="radio"][value="aplicar"], input[type="radio"][value="relevo"]');
    for (let i = 0; i < (await radios.count()); i++) await radios.nth(i).check();
    await card.getByRole("button", { name: "Aprobar" }).click();
    await toast(page, /Fila aprobada/);
  }
  await page.getByRole("button", { name: /Escribir \d+ aprobadas en RELEVO/ }).click();
  await toast(page, /Listo: \d+ filas escritas/);
  await page.reload();

  const companyName = process.env.CRM_XLSX ? null : `Hotel E2E ${tag}`;
  const first = page.getByRole("link", { name: "Abrir ficha" }).first();
  await first.click();
  await expect(page.getByText("Qué sabemos y de dónde salió")).toBeVisible();
  await expect(page.getByText("De dónde salió", { exact: true })).toBeVisible();
  await expect(page.getByText(/CRM de Sheets/)).toBeVisible();
  if (companyName) {
    await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
    await expect(page.getByText("Existencia, categoría y teléfono")).toBeVisible();
    await expect(page.getByText("Identificar decisor")).toBeVisible();
    await expect(page.locator("li", { hasText: "Administración" }).getByText("Canal institucional")).toBeVisible();
    await expect(page.getByText(`Solicitar reunión ${tag}`)).toBeVisible();

    // Reimportar el mismo archivo: todo sin cambios.
    await page.goto("/w/daicou/integraciones");
    await page.locator('input[type="file"][name="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Analizar archivo" }).click();
    await page.waitForURL(/\/integraciones\/importar\//);
    await expect(page.getByText("0 por decidir")).toBeVisible();
    await expect(page.getByText("4 sin cambios")).toBeVisible();
  }
});
