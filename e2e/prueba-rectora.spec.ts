// Prueba rectora (documento maestro §4) en local:
// Tano documenta objetivos con fuente/verificación, arma una jornada con Maps, registra
// una visita, propone hallazgos, aprueba uno y rechaza otro, propone una candidata y pide
// aprobación. Fran ve la decisión en su inicio, aprueba, comenta y publica un briefing.
// Un usuario de solo lectura ve todo sin poder editar. Todo el dato creado es DEMO.
import { expect, test } from "@playwright/test";
import { USERS, login, openDetails, toast } from "./helpers";

const run = Date.now().toString(36);
const LOCAL = `DEMO E2E Local ${run}`;
const LOTE = `DEMO E2E Lote ${run}`;
const F_OK = `El encargado dice que tercerizan la lavandería y no están conformes (${run})`;
const F_NO = `Rumor sin fuente clara sobre venta del local (${run})`;
const OPP = `Lavandería para campamentos ${run}`;

test.describe.configure({ mode: "serial" });

test("de la campaña al dealflow con decisión de Fran", async ({ page }) => {
  // --- Tano: objetivos ---------------------------------------------------------------
  await login(page, USERS.tano);
  await expect(page.getByRole("button", { name: "Ver vista ejecutivo" })).toBeVisible();
  await expect(page.getByText("Qué hacer ahora")).toBeVisible();
  await page.getByRole("link", { name: "Red", exact: true }).first().click();
  await page.getByRole("link", { name: /Añelo — Discovery 2026/ }).click();

  let form = await openDetails(page, "+ Agregar objetivo");
  await form.getByLabel("Nombre del establecimiento").fill(LOCAL);
  await form.getByLabel("Dirección", { exact: true }).fill("Calle de prueba 123");
  await form.getByLabel("Es un registro DEMO (ficticio)").check();
  await form.getByText("Gastronomía", { exact: true }).click();
  await form.getByLabel("Próxima acción", { exact: true }).fill("Visitar al encargado");
  await form.getByRole("button", { name: "Agregar objetivo" }).click();
  await toast(page, "Objetivo agregado.");
  await expect(page.getByRole("link", { name: LOCAL })).toBeVisible();

  form = await openDetails(page, "+ Agregar objetivo");
  await form.getByLabel("Tipo", { exact: true }).selectOption("asset");
  await form.getByLabel("Título", { exact: true }).fill(LOTE);
  await form.getByLabel("Dirección", { exact: true }).fill("Ruta de prueba km 1");
  await form.getByLabel("Es un registro DEMO (ficticio)").check();
  await form.getByText("Inmuebles y tierra", { exact: true }).click();
  await form.getByRole("button", { name: "Agregar objetivo" }).click();
  await toast(page, "Objetivo agregado.");
  await expect(page.getByRole("link", { name: LOTE })).toBeVisible();

  // --- Tano: jornada con dos paradas y Google Maps --------------------------------------
  await page.getByRole("link", { name: "Agenda y mapa" }).first().click();
  form = await openDetails(page, "+ Nueva jornada");
  await form.getByLabel("Título", { exact: true }).fill(`DEMO E2E Jornada ${run}`);
  await form.getByRole("button", { name: "Crear jornada" }).click();
  await page.waitForURL(/\/agenda\/[0-9a-f-]{36}$/);
  for (const name of [LOCAL, LOTE]) {
    form = await openDetails(page, "+ Agregar parada");
    // Esperar a que el formulario esté limpio (el alta anterior lo resetea al terminar).
    await expect(form.getByLabel("Objetivo")).toHaveValue("");
    await form.getByLabel("Objetivo").selectOption({ label: name });
    await form.getByRole("button", { name: "Agregar", exact: true }).click();
    // Confirmación por el resultado, no por un aviso que puede ser del alta anterior.
    await expect(page.locator("ol").getByRole("link", { name, exact: true })).toBeVisible();
  }
  const route = page.getByRole("link", { name: "Abrir recorrido en Maps" });
  await expect(route).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=.+&waypoints=/);
  await expect(page.getByText("2 parada(s) con dirección sin verificar.")).toBeVisible();

  // --- Tano: visita con notas -------------------------------------------------------
  await page.getByRole("link", { name: "Registrar visita" }).first().click();
  await page.getByLabel("Con quién hablaste").fill("Encargado (DEMO)");
  await page.getByLabel("Notas de la visita").fill("DEMO: notas de prueba del flujo de punta a punta.");
  await page.getByLabel("Es una visita DEMO (ficticia)").check();
  await page.getByRole("button", { name: "Guardar visita" }).click();
  await expect(page.getByText("Visita guardada.")).toBeVisible();

  // --- Tano: dos hallazgos desde la visita ------------------------------------------
  for (const statement of [F_OK, F_NO]) {
    form = await openDetails(page, "+ Proponer hallazgo");
    await form.getByLabel("Hallazgo", { exact: true }).fill(statement);
    await form.getByRole("button", { name: "Registrar hallazgo" }).click();
    await toast(page, /Hallazgo registrado/);
    await expect(page.locator("article", { hasText: statement })).toBeVisible();
  }

  // --- Tano: revisión humana: aprueba uno, rechaza otro ------------------------------
  await page.goto("/w/daicou/oportunidades");
  await page.locator("article", { hasText: F_OK }).getByRole("button", { name: "Aprobar", exact: true }).click();
  await toast(page, /Hallazgo aprobado/);
  await page.locator("article", { hasText: F_NO }).getByRole("button", { name: "Rechazar", exact: true }).click();
  await toast(page, "Hallazgo rechazado.");

  // Aprobar un hallazgo no crea ninguna oportunidad.
  await page.goto("/w/daicou/oportunidades/candidatas");
  await expect(page.getByText(OPP)).toHaveCount(0);

  // --- Tano: candidata desde el hallazgo aprobado y pedido de aprobación -------------
  await page.goto("/w/daicou/oportunidades?estado=aprobado");
  await page.locator("article", { hasText: F_OK }).getByRole("checkbox", { name: "Incluir en la candidata" }).check();
  form = await openDetails(page, "Proponer oportunidad candidata");
  await form.getByLabel("Título de la oportunidad").fill(OPP);
  await form.getByLabel("Vía posible").selectOption("creacion_propia");
  await form.getByRole("button", { name: "Proponer candidata" }).click();
  await page.waitForURL(/\/oportunidades\/o\/[0-9a-f-]{36}$/);
  const oppUrl = page.url();
  await expect(page.getByText("Candidata", { exact: true })).toBeVisible();
  await expect(page.getByText(/Ningún hallazgo que la sustenta está verificado/)).toBeVisible();
  await page.getByRole("button", { name: "Pedir aprobación" }).click();
  await toast(page, /Aprobación solicitada/);

  // --- Fran: ve la decisión en su inicio, aprueba y comenta -------------------------
  await login(page, USERS.fran);
  await expect(page.getByRole("button", { name: "Ver vista operativo" })).toBeVisible();
  // En la vista ejecutiva de Fran, su voto pendiente va primero ("Esperan tu decisión").
  await expect(page.getByText("Esperan tu decisión")).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Pasamos .${OPP}. al dealflow`) })).toHaveCount(1);
  await page.goto(oppUrl);
  await page.getByLabel("Fundamento (queda registrado)").fill("Vale la pena validar demanda con 3 campamentos.");
  await page.getByRole("button", { name: "Aprobar y pasar a dealflow" }).click();
  await toast(page, "Decisión registrada.");
  await expect(page.getByText("Aprobada (en dealflow)")).toBeVisible();
  await expect(page.getByText("Etapa actual:")).toContainText("Contacto identificado");
  await page.getByLabel("Comentario / brainstorming").fill("Ojo con la competencia de Neuquén capital.");
  await page.getByRole("button", { name: "Comentar" }).last().click();
  await toast(page, "Comentario agregado.");

  // --- Fran: briefing conjunto con referencias, publicado en la app -----------------
  await page.goto("/w/daicou/oportunidades/briefings");
  await page.getByRole("button", { name: "Generar briefing" }).click();
  await page.waitForURL(/\/briefings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: new RegExp(`Visita a ${LOCAL}`) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Decisión aprobada: .*${OPP}`) })).toBeVisible();
  await page.getByRole("button", { name: /Publicar en la app/ }).click();
  await expect(page.getByText(/Publicado en la app/).first()).toBeVisible();

  // --- Visor: ve todo, no edita ni decide ------------------------------------------
  await login(page, USERS.visor);
  await page.goto(oppUrl);
  await expect(page.getByText("Aprobada (en dealflow)")).toBeVisible();
  await expect(page.getByText("Actualizar etapa")).toHaveCount(0);
  await expect(page.getByText("+ Tarea")).toHaveCount(0);
});

test("@mobile registrar visita desde el teléfono en pocos toques", async ({ page }) => {
  await login(page, USERS.tano);
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Red", exact: true }).click();
  await page.getByRole("link", { name: /Añelo — Discovery 2026/ }).click();
  await page.getByRole("link", { name: "Registrar visita" }).first().click();
  await expect(page.getByRole("heading", { name: "Registrar visita" })).toBeVisible();
  // Sin scroll horizontal en 412px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
