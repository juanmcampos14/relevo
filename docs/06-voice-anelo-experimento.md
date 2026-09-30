# Voice of Añelo · Experimento digital de investigación — recomendación de lanzamiento

Fecha: 30/09/2026. Estado: evaluación y preparación. **No autoriza publicación ni gasto.**
Hilo separado del Morning Brief / CRM. Comparte RELEVO como sistema de registro.

Materiales revisados: `voice-anelo-v1.md` (cuestionario + campaña), `voice-anelo-materiales-v1.zip` (formulario HTML, 6 PNG + 6 SVG), `relevo-discovery-integrado-v1.md` (H-VA-01…16), CRM Sheet (pestañas y permisos) y el código de RELEVO.

---

## 1. Accesos comprobados

| Acceso | Estado | Qué se verificó |
|---|---|---|
| Google Drive / Sheets (cuenta de Juan) | **Comprobado** | Lectura de los 5 materiales y del CRM. Juan es *editor* de la carpeta central y del CRM; propietaria: `vilamajo.e@gmail.com`. |
| Permisos de carpeta central y CRM | **Riesgo** | Ambos están compartidos como **"cualquiera con el enlace puede ver"**. El CRM tiene contactos. Ninguna respuesta de encuesta debe caer en esa carpeta. |
| Google Forms | Disponible, no probado | Cualquier cuenta Google puede crear uno; no se creó nada. |
| Google Ads | **No comprobado** | No hay rastro de cuenta ni credenciales. No hace falta para V1. |
| Meta (Página, Business, cuenta publicitaria, medio de pago) | **No comprobado** | No hay credenciales ni integración en el repo, y no entré a la cuenta de Meta de Juan. Necesito que Juan lo confirme (ver §6). |
| RELEVO (Vercel + Supabase) | **Comprobado** | Producción en `relevo-juan-campos.vercel.app`. Next 16 + Supabase con RLS, auditoría, `decisions` con aprobación y endpoint de ingesta con token. **No existe** formulario público, integración con Meta ni API de Google (el CRM entra por `.xlsx` manual). |

## 2. Camino más rápido para lanzar

**Recomendado — Ruta A: formulario propio en RELEVO + campaña manual en Meta.**

1. Portar el prototipo HTML (15 preguntas, ramificaciones ya resueltas) a una página pública de RELEVO: `/r/voice-anelo`. Las respuestas se guardan directamente en Supabase con acceso restringido. Nada pasa por Drive.
2. Campaña creada **a mano en Ads Manager** (objetivo Tráfico → vistas de landing). Cada anuncio apunta a la misma URL con parámetros dinámicos de Meta:
   `?utm_source=meta&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&pl={{placement}}&v=v1`
   Esto da la atribución anuncio → respuesta **sin píxel ni envío de datos a Meta**.
3. Métricas de Meta: exportar CSV diario desde Ads Manager y subirlo a RELEVO (mismo patrón que el importador del CRM).

Por qué esta ruta y no Google Forms: el pedido exige visitas, inicios, abandono por pregunta y relación respuesta ↔ anuncio ↔ versión. Google Forms solo registra envíos completos, muestra el campo de UTM al usuario y deja las respuestas en una hoja de Drive que hoy hereda permisos públicos.

**Alternativa — Ruta B (si el desarrollo se atrasa más de 2 días): Google Form.**
- Secciones con "ir a sección según respuesta" para las ramificaciones.
- Campo `origen` prellenado por URL (`entry.XXXX=A`, uno por anuncio).
- Hoja de respuestas en una carpeta **nueva, sin enlace público**, fuera de la carpeta central.
- Se lanza el mismo día. Se pierde el embudo (inicios/abandono). Los CSV se importan a RELEVO después.

**Cuenta publicitaria: propia vs. agencia (Jota).**
- *Propia (preferida):* portafolio comercial de RELEVO + Página "RELEVO" + cuenta publicitaria a nombre de RELEVO. Da titularidad y continuidad. Riesgo: las cuentas nuevas empiezan con límite de gasto y a veces quedan restringidas en la primera revisión. Ese plazo **es incierto**.
- *Agencia, si la cuenta propia se traba:* aceptable solo por escrito con lo siguiente:
  - la Página y la identidad visible son de RELEVO (la agencia opera como *partner* con acceso a la Página, no con su propia Página);
  - la cuenta publicitaria es de RELEVO, o la agencia comparte acceso de análisis y exporta los CSV;
  - las respuestas nunca pasan por la agencia (el formulario es de RELEVO);
  - facturación desglosada entre gasto, impuestos y honorarios;
  - traspaso de creatividades y datos al terminar.

## 3. Formulario, recepción segura, atribución y visualización

**Modelo mínimo (migración nueva):**

| Tabla | Contenido | Acceso |
|---|---|---|
| `research_experiments` | Mercado (campaign/misión), hipótesis vinculadas (findings), estado, techo de presupuesto, `decision_id` de aprobación | miembros |
| `experiment_variants` | Copy, creatividad, CTA, gancho, `utm_content`, `ad_id` de Meta, qué variable cambia | miembros |
| `survey_versions` | Definición JSON de las preguntas, inmutable por versión (V1, V1.1…) | miembros |
| `survey_sessions` | ID pseudónimo, variante, UTM, placement, eventos (vista / inicio / pregunta N / fin / fuera de alcance) | owner/admin |
| `survey_responses` | Respuestas crudas (jsonb), versión, sesión | **owner/admin únicamente**: patrón nuevo, hoy el RLS es solo por workspace |
| `ad_metrics_daily` | CSV de Meta: gasto, alcance, impresiones, clics, reacciones por anuncio y día | miembros |

**Seguridad de la ruta pública:**
- Copiar el patrón de `api/ingest/findings`: validación zod y límite de tamaño.
- Agregar honeypot y un límite por IP hasheada (el hash rota a diario y la IP no se guarda).
- Sin cookies de terceros ni píxel.
- Advertencia en los textos libres; la redacción de nombres se hace antes de mostrar citas.

**Del dato crudo a la evidencia (sin promoción automática):**

| Nivel | Qué es | Dónde queda en RELEVO |
|---|---|---|
| HECHO | Métricas de medición (gasto, n, embudo) | `ad_metrics_daily` / `survey_sessions` |
| DECLARACIÓN | Cada respuesta, aunque relate un hecho | `survey_responses` (restringida). Cuando un humano la revisa, se crea una fila `evidence` con `evidence_type='declaracion'` y `origin_kind='survey'` (valor nuevo). Si está redactada, la cita va en `quote`. |
| INFERENCIA | Agrupaciones y patrones revisados | `findings.analysis`, vinculado por `finding_evidence` (*supports / contradicts*) |
| HIPÓTESIS | H-VA-01…16 | `findings` con `maturity='hipotesis'` y `external_refs` → `H-VA-xx` (Sheet) |

- Las respuestas satisfechas se guardan y cuentan como *contradicts* o *contextual*.
- Ninguna persona encuestada entra a `contacts`.
- Las hipótesis H-VA **no existen todavía en RELEVO**, porque el importador no toma INVESTIGACIÓN | ENTREVISTAS. Se cargan una vez, conservando los IDs del Sheet. Es la única migración de datos que hace falta.

**Vista del experimento en RELEVO:**
- Embudo por variante: gasto → impresiones → clics → vistas → inicios → válidas → útiles.
- Costo por válida y por útil.
- Segmentos S1/S2/S3 y episodios por categoría, siempre con *n* y denominador visible.
- Ejemplos junto a contraejemplos.
- Cortes con menos de 5 respuestas: se combinan o se suprimen.
- Leyenda fija: "autoselección, no representativo; clic = atención, respuesta = declaración".

**Límites de atribución (a declarar en la vista):**
- La UTM identifica el anuncio del último clic, no la exposición.
- Quien comparte el enlace hereda la UTM.
- Sin un experimento A/B de Meta con reparto aleatorio, la distribución entre anuncios la decide el algoritmo. La comparación es exploratoria.

## 4. Automatizar ahora / operar a mano

**Ahora:**
- Formulario público y guardado.
- Eventos de embudo.
- Atribución por UTM.
- Versionado del cuestionario.
- Importación del CSV de Meta.
- Vista agregada con supresión de cortes chicos.
- Aprobación con `decisions` (nuevos `kind`: `aprobar_presupuesto`, `aprobar_publicacion`; reutiliza el guard `can_approve`).

**A mano al principio:**
- Crear, pausar y escalar la campaña en Ads Manager.
- Codificar respuestas a `pain_code` y H-VA. Opcional: la IA sugiere con `proposals` y un humano acepta.
- Promover a evidencia y hallazgos.
- Decisión de continuar, debilitar o descartar (Tano/Fran).

**Después (requiere Meta App):**
- *Leer métricas por API* (Marketing API, `ads_read` sobre cuentas propias). En principio alcanza con acceso estándar, sin App Review, pero puede pedir verificación del negocio para el usuario de sistema. **Plazo incierto.**
- *Crear o publicar anuncios desde RELEVO* (`ads_management`). Probablemente requiere App Review y verificación del negocio. **Plazo incierto, de semanas.** No bloquea nada: por eso V1 es manual.

## 5. Permisos y revisiones externas

| Ítem | Tiempo de desarrollo | Espera externa |
|---|---|---|
| Formulario en RELEVO (Ruta A) | 2–3 días | ninguna |
| Google Form (Ruta B) | 2–4 h | ninguna |
| Página + portafolio + cuenta publicitaria nueva | 1 h de Juan | Límite inicial de gasto y posible restricción: **incierto**, de horas a días |
| Revisión de anuncios de Meta | — | Suele ser menos de 24 h. **No garantizado.** |
| Verificación del negocio en Meta | 1 h (documentos) | **Incierto**, días. No es necesaria para V1. |
| API de Meta (lectura / publicación) | 1–2 días | Lectura: probablemente ninguna. Publicación: App Review, **incierto** |
| Política de datos / responsable | 2 h de redacción | Decisión de Estanislao. Evaluar si corresponde inscribir la base ante la AAIP (Ley 25.326): consulta legal, no lo afirmo. |

## 6. Qué necesito de Estanislao / Juan

1. **Meta:** ¿existe Página "RELEVO"? ¿Portafolio comercial? ¿Cuenta publicitaria, medio de pago, moneda y zona horaria?
   - Moneda y zona horaria **no se pueden cambiar después**. Recomiendo USD o ARS según la tarjeta, con zona America/Argentina/Buenos_Aires.
   - ¿Quién es administrador?
2. **Decisión** entre cuenta propia y Jota. Si es Jota, las condiciones de §2 por escrito.
3. **Identidad pública:** nombre visible, responsable y contacto real (email) para la landing y la política de datos. ¿Dominio propio o `relevo-juan-campos.vercel.app`? Recomiendo un subdominio propio: da confianza y evita un nombre personal visible.
4. **Aprobación de copies y creatividades.** Las PNG llevan impreso "BORRADOR PARA REVISIÓN · NO PUBLICADO" y hay que regenerarlas desde los SVG.
5. **Ganchos nuevos:**
   - V1 prueba **dos anuncios completos**: A "Tu experiencia en Añelo cuenta" y un gancho nuevo, por ejemplo "¿Qué fue lo último que tuviste que ir a buscar fuera de Añelo?".
   - La creatividad visual es la misma y solo cambia el texto. Así la diferencia se atribuye al mensaje.
   - El "un toque por categoría" se implementa como pantalla 0 del formulario y cuenta como micro-conversión.
6. **Presupuesto** (abajo) y *go* de publicación.
7. **Cinco personas para el piloto** (medir duración antes de anunciar minutos).

## 7. Tiempo y costo estimados

**Calendario tentativo** (AOG 19–22/10; campo 16–26/10):

| Fecha | Hito | Depende de |
|---|---|---|
| 1–3/10 | Formulario en RELEVO, CSV import, vista. En paralelo: cuenta de Meta y política de datos. | Punto 1 de §6 |
| 3–4/10 | Piloto con 5 personas y ajustes. Creatividades finales. | Puntos 4 y 7 |
| 5/10 | Revisión final con Estanislao → aprobación en RELEVO → envío a revisión de Meta | Aprobación |
| 6–12/10 | Campaña de 7 días. Control a las 48 h. Decisión del tramo de USD 90 al gastar USD 60. | Revisión de Meta (incierta) |
| 13–14/10 | Síntesis → preguntas para AOG y ajustes del guion de campo | — |

**Costo** (no aprobado):
- Pauta: USD 60, más hasta USD 90 condicionados, antes de impuestos.
- Impuestos en Argentina sobre servicios digitales del exterior: IVA 21% (máximo USD 181,50) más posibles percepciones según el medio de pago y la normativa vigente. **A confirmar con el resumen de tarjeta y un contador.** Techo prudente para aprobar: aproximadamente **USD 230** con todo incluido, sin honorarios.
- Agencia: honorarios a cotizar si se usa.
- Infraestructura: USD 0 incremental (Vercel y Supabase ya en uso).
- Desarrollo: tiempo interno de 2–3 días.

## Correcciones a los materiales antes de publicar

- El prototipo usa `confirm()` para el filtro de 0 días. Pasarlo a una pantalla propia.
- Completar el placeholder "Responsable, contacto y política de datos".
- Sacar la leyenda de borrador de las PNG.
- Opcional: sacar el botón dibujado dentro de la imagen, porque Meta ya muestra su CTA.
- Verificar en Ads Manager el radio mínimo y la audiencia estimada de Añelo. La población es chica y puede quedar bajo el mínimo de entrega; en ese caso, ampliar a un radio que incluya los yacimientos cercanos y documentarlo.
