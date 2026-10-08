# 11 · El CRM como fuente: revisión de arquitectura y costos

Fecha: 8 de octubre de 2026. Estado: **propuesta para decidir; no se implementó nada ni se tocó producción.**

Pregunta: si la investigación, el análisis y el Morning Brief se hacen afuera (ChatGPT + Sheets + Drive + Fireflies + Clay), ¿qué tiene que ser RELEVO, qué conservamos de lo construido y qué dejamos de correr?

Respuesta corta: **RELEVO pasa a ser la capa ejecutiva y de memoria sobre el CRM.** Lee el Sheet seguido, entiende qué cambió, lo relaciona con lo que ya sabe y lo muestra en Hoy / Misión / Brain. Deja de investigar y de sintetizar por su cuenta. Casi todo lo de B se reutiliza tal cual; lo que se apaga es la capa de IA de fondo que hoy duplica lo que se hace en ChatGPT, que es justamente lo más caro.

---

## 1. Qué lee hoy RELEVO del CRM, cada cuánto y cómo lo reconcilia

**Frecuencia.** Cada hora, al minuto 5, de 07:05 a 22:05 (hora Argentina). Primero pregunta a Google cuándo cambió el Sheet por última vez; si no cambió, no baja nada. Si cambió, lo baja entero y procesa **solo las filas que cambiaron** (huella por fila).

**Funciona en producción con tu trabajo real.** Ayer, mientras cargabas desde ChatGPT, entraron solas 49 empresas y 16 contactos nuevos en cinco corridas (16:05 a 20:05), sin carga manual. Brain tiene hoy 156 empresas.

| Pestaña | ¿La lee? | Cómo se reconcilia |
|---|---|---|
| EMPRESAS | Sí, parcialmente | Diff a tres puntas (lo último que vino del Sheet / lo que dice el Sheet ahora / lo que dice RELEVO). Si solo cambió el Sheet, se aplica solo. Si una persona corrigió el dato en RELEVO, no se pisa: queda como "información diferente" para decidir. Una fila que podría ser una empresa que ya conocemos con otro nombre no se crea: queda para revisar. |
| RED \| CONTACTOS | Sí | Igual que EMPRESAS. |
| ACTIVIDADES (oculta) | Sí | Igual: cada actividad es una tarea. |
| FUENTES (oculta) | Sí | Igual: cada fuente es una fuente, con su URL. |
| RADAR DE MERCADO | Sí | Cada fila nueva o modificada se compara contra lo que ya sabíamos (IA, Sonnet, ~USD 0,03 por tanda): mismo hecho = una fuente más; hecho nuevo = señal; activo = activo con historial de precios. Solo genera tarea si cambia algo material. |
| OPORTUNIDADES | **No** | Hoy está vacía. |
| HALLAZGOS | **No** | 2 filas (HAL-001, HAL-002). |
| RUTA \| VISITAS | **No** | 54 puntos de agenda. |
| INVESTIGACIÓN \| ENTREVISTAS | **No** | Banco de preguntas y respuestas. |
| AOG \| MAPA FÍSICO | **No** | 30 actores con objetivo y día. |
| INICIO, CENTRO DE CONTROL, DATOS \| CONTROL | No (y no hace falta) | Son vistas calculadas, no datos. |

**Columnas de EMPRESAS que NO lee:** Vertical canónico, Subsector (sí lee), Estado ejecutivo, Evidencia ejecutiva, Tesis actual, Próxima decisión, Rol misión, Prioridad ejecución y las columnas de inversión (Perfil inversión, Problema / limitante, Palanca, Apertura dueño / socio, Señal financiera, Próximo paso inversión). Las de inversión las dejamos afuera a propósito por tu pedido del 6/10; las demás simplemente no existían cuando armamos el mapeo.

**Trazabilidad que ya existe:** cada corrida (cuándo, qué versión del Sheet, qué filas cambiaron, qué hizo), cada fila procesada con lo que traía y lo que se aplicó, y cada decisión sobre información diferente con quién y cuándo.

**Huecos detectados al revisar:**
- Una fila **borrada** del Sheet no llega a RELEVO (lo vimos en la limpieza de la prueba).
- Agregar una **columna** cambia la huella de todas las filas: el 7/10 a las 21:05 se reprocesaron 151 empresas sin ningún cambio real. En EMPRESAS no cuesta nada (no usa IA), pero en RADAR haría pasar las 66 filas por la IA. Se arregla calculando la huella solo con las columnas que RELEVO usa.
- Hay **9 informaciones diferentes** y unas **13 filas para revisar** (posibles duplicados) pendientes de decisión.

## 2. Qué se reutiliza de B y C

**Se conserva todo B** — es exactamente la pieza que conecta los dos mundos:
- Lectura del Sheet, detección por delta, diff a tres puntas, "información diferente", precedencia humana, regla de no vaciar datos en silencio, trazabilidad por corrida y por fila.
- Reconciliación contra lo conocido (misma empresa con otro nombre, mismo hecho de otra fuente, mismo activo en otro portal). ChatGPT trabaja fila por fila; RELEVO es quien ve que dos filas son la misma cosa o que una noticia ya la sabíamos.

**Se conserva el modelo de A** — y encaja casi uno a uno con tus pestañas:

| Tu pestaña | Modelo que ya existe en RELEVO |
|---|---|
| OPORTUNIDADES (Consumidor, Decisor, Pagador, Unidad económica, Capacidad nominal, Utilización, Demanda rechazada, Limitante, Palanca, Qué falta saber, Próxima validación, Carril, Etapa) | Oportunidad candidata con su ficha y sus partes (consumidor / decisor / pagador), carril y madurez. Son los mismos campos. |
| RUTA \| VISITAS (Día, Franja, Zona, Objetivo, Pregunta clave, Estado visita, Hallazgo / conclusión, Próxima acción) | Paradas generalizadas: tipo, franja, objetivo, pregunta clave, resultado. |
| HALLAZGOS (Evidencia, Contraevidencia, Qué falta saber, Comprador / pagador, Estado evidencia) | Hallazgos con nivel de evidencia. |
| Próxima acción / Fecha próxima acción | La tarea como próxima acción canónica. |

**Se conserva la dirección visual de C1** (Hoy / Misión / Brain, input sin micrófono, estados). Cambia de dónde sale el contenido: del CRM en vez de la síntesis de RELEVO.

**Se deja de construir:** C2 y C3 tal como estaban pensados (RELEVO razonando cada línea de investigación por su cuenta). Esa inteligencia hoy vive en ChatGPT y llega como columnas: Tesis actual, Qué falta saber, Próxima validación, Próxima decisión.

## 3. Qué hace falta para alimentar Hoy, Misión, Brain y las fichas desde el CRM

Principio: **lo que el CRM ya dice se muestra; RELEVO solo agrega lo que solo él puede ver** (qué cambió desde tu última visita, qué contradice a qué, qué dos cosas son la misma).

| Superficie | De dónde sale | IA |
|---|---|---|
| **Hoy · Cambió** | Lo que la sincronización detectó desde tu última visita: etapa que avanzó, hallazgo nuevo, fila del Radar marcada "Cambio material", oportunidad que cambió de etapa. | No (es el delta). |
| **Hoy · Requiere de vos** | Información diferente, posibles duplicados, oportunidades con "Decisión" pendiente, "Próxima decisión" con fecha. | No. |
| **Hoy · Qué movería** | "Próxima acción" / "Próxima validación" con fecha, ordenadas por vencimiento y prioridad. | No. |
| **Misión** | Propósito y estado: una fila de configuración de la misión en el Sheet (o CONFIG). Líneas: las verticales del CRM, con lo que dicen OPORTUNIDADES y HALLAZGOS de cada una. Próximos días: RUTA \| VISITAS. | No. |
| **Brain** | Lo que ya está en RELEVO (empresas, personas, activos, señales, fuentes) + hallazgos, oportunidades y visitas cuando se lean. Búsqueda sobre eso. | No para mostrar. Sí para preguntar en lenguaje natural (a pedido). |
| **Ficha** | Todas las filas del CRM que tocan esa entidad (empresa + contactos + actividades + hallazgos + visitas + fuentes) y su historial de cambios. "Lo que sabemos": la Tesis actual del CRM; si no hay, un resumen corto que se regenera **solo cuando cambia una fila de esa entidad**. | Opcional y por delta. |

**Trabajo concreto (estimado):**
1. Mapear y leer OPORTUNIDADES, HALLAZGOS y RUTA \| VISITAS (y AOG si lo querés), con el mismo circuito de B. Es lo más grande: unos días.
2. Leer las columnas nuevas de EMPRESAS (Vertical canónico, Tesis actual, Estado ejecutivo, Próxima decisión, y las de inversión si ahora lo autorizás).
3. Huella por columnas usadas, y detectar filas borradas (marcarlas, nunca borrar de RELEVO).
4. Sincronización más frecuente (punto 5).
5. Recién entonces C1, ya alimentado por el CRM.

**Qué necesito saber de tu circuito externo:** dónde deja el resultado tu Morning Brief (¿filas en RADAR? ¿un doc en Drive? ¿un mail?) y dónde deja Fireflies lo estructurado (¿en qué pestaña?). Si todo termina en el Sheet, RELEVO ya lo ve.

## 4. Qué se puede suspender o simplificar

Medido en producción, al ritmo del 3 al 7 de octubre: **unos USD 98/mes de IA**.

| Proceso | USD/mes | Propuesta |
|---|---|---|
| Síntesis diaria de la misión (Opus): frentes, foco, qué creemos | 17,3 | **Suspender.** Lo reemplazan Tesis / Estado ejecutivo / Próxima decisión del CRM. |
| Avanzar preparado (mensajes y pasos listos por oportunidad) | 18,3 | **Suspender.** El próximo paso ya está en el CRM; el mensaje lo armás en ChatGPT. |
| Objetivos por hipótesis | 11,6 | **Suspender.** |
| Estado de misión | 8,3 | **Suspender.** |
| Estado de hallazgos (análisis a pedido) | 7,8 | **Suspender.** Los hallazgos los evaluás en el CRM. |
| Morning Brief de RELEVO (investigación + armado) | 6,7 | **Suspender** si tu circuito externo cubre lo mismo; RELEVO muestra lo que el tuyo produce. |
| Vigilancia 2 veces por día | 2,8 | **Suspender** junto con el Brief (o dejar solo los "avisame cuando…" puntuales). |
| Plan de AOG | 1,2 | Ya cumplió; suspender. |
| Conversación con RELEVO | 22,6 | **Simplificar:** preguntar sobre lo que sabemos (Brain), en Sonnet, sin investigación web por defecto. Es lo que necesita Fran. |
| Reconciliación del Sheet / Radar | 1,1 | **Conservar.** |
| Capturas de campo y "desde tu visita" | 1,0 | Conservar. |

Todo se apaga con configuración (sacar los cron y apagar los procesos), sin borrar código ni datos: si algo hace falta de nuevo, se prende.

## 5. Costos: qué ahorrás y qué cuesta sincronizar más seguido

**IA:** de ~USD 98/mes a **~USD 15–30/mes**. El rango depende de cuánto se use la conversación; lo de fondo queda en ~USD 2–5. *(Medición de 5 días; la investigación web del Brief recién se registra completa desde el 6/10, así que el ahorro real es igual o mayor.)*

**Sincronización más frecuente:**
- Preguntar "¿cambió el Sheet?" es una llamada de metadatos a Google: gratis.
- Se baja y procesa solo cuando cambió (~190 KB) y solo las filas cambiadas.
- La única parte con IA es el Radar: ~USD 0,03 por tanda → **~USD 1–3/mes** aunque cargues todo el día.
- Propuesta: **cada 2–3 minutos**, esperando a que el Sheet quede quieto ~2 minutos antes de procesar (para no leer una carga de ChatGPT a medias). Lo de ChatGPT aparecería en RELEVO en 3–5 minutos.
- Por qué no "al instante por evento": los avisos de Google Sheets por edición no se disparan cuando escribe una integración (ChatGPT escribe por API), y los avisos de Drive vencen y hay que renovarlos. El sondeo cada 2–3 minutos es más simple, más confiable y cuesta lo mismo.
- Infraestructura: los cron de Vercel están armados como 16 entradas diarias, lo que sugiere el plan gratuito, que solo permite una corrida por día por entrada. Para cada 2–3 minutos: (a) disparar el chequeo desde la base de datos (Supabase pg_cron, sin costo extra), o (b) plan Pro de Vercel (USD 20/mes). Recomiendo (a). Hay que confirmar el plan actual de Vercel y Supabase para cerrar la cuenta de costos fijos, que esta revisión no cambia.

## 6. Misiones, decisiones, permisos, trazabilidad e historial

**Fuente de verdad, una por tipo de dato:**

| Dato | Fuente de verdad | Qué hace RELEVO |
|---|---|---|
| Empresas, contactos, oportunidades, hallazgos, visitas, radar, verticales, tesis, próximas acciones, decisiones de inversión | **El CRM (Sheet)** | Lo lee, lo reconcilia, lo guarda con historial. No lo edita. |
| Documentos, transcripciones, audios | **Drive** | Guarda el link como fuente. |
| Qué entidad es cuál (una empresa con tres nombres, un hecho con cinco fuentes), qué cambió y cuándo, qué vio cada persona | **RELEVO** | Es lo que solo RELEVO sabe. |
| Decisiones tomadas en RELEVO (información diferente, duplicados, triage) | **RELEVO**, con quién y cuándo | Propuesta: además, escribirlas en una pestaña nueva del Sheet, solo de agregar filas (p. ej. "RELEVO \| DECISIONES"), para que ChatGPT las vea. Requiere darle a la cuenta de servicio permiso de edición **solo** en esa pestaña. |
| Quién ve qué misión | **RELEVO** | Ya existe por misión (owner / puede trabajar / solo mira). |

**Misiones independientes.** Hoy el Sheet está configurado por workspace. Propuesta: **un Sheet por misión**, configurado en la misión. Lo de cada Sheet entra a su misión; la memoria común (una empresa que aparece en dos misiones) sigue siendo una sola. Ojo: los permisos del Sheet los maneja Google, no RELEVO. Quien tenga el Sheet compartido lo ve entero, aunque en RELEVO no sea de esa misión.

**Historial.** RELEVO guarda cada versión de cada fila que vio y qué hizo con ella. Una fila borrada en el Sheet quedaría marcada "ya no está en el Sheet", nunca borrada de RELEVO (hoy no se detecta: punto 3).

**Correcciones de campo.** Si Fran corrige algo desde RELEVO, la regla más simple es que vaya como corrección propuesta a la pestaña de decisiones del Sheet, y el CRM decida. Así no hay dos lugares editando el mismo dato.

## 7. Diez verticales vs. siete líneas

Las 7 líneas de RELEVO no son una estructura propia: las **inventó la síntesis de Opus** a partir de los hallazgos de septiembre. Las 10 verticales son la taxonomía del CRM (y la columna "Vertical canónico" ya clasifica las 152 empresas). Propuesta: **las verticales del CRM son las líneas de Misión**; RELEVO deja de generar las suyas.

| Línea actual de RELEVO | Vertical del CRM | Empresas en el CRM |
|---|---|---|
| Housing y alojamiento | 01 · Housing & alojamiento | 43 |
| Viandas y alimentación | 02 · Alimentación | 16 |
| — (estaba dentro de "Flotas") | 03 · Movilidad de personas | 6 |
| Servicios operativos (lavandería, lavaderos, limpieza) | 04 · Lavandería & limpieza | 9 |
| Flotas, talleres y logística | 05 · Automotor simple | 11 |
| Vida cotidiana y servicios técnicos | 06 · Retail cotidiano | 17 |
| (idem) | 07 · Salud & bienestar | 9 |
| (idem) | 08 · Deporte & ocio | 1 |
| (idem) | 09 · Familias & ciudad permanente | 1 |
| Activos e inmuebles | 10 · Espacio comercial & inmobiliario | 25 |
| **Abastecimiento industrial y urgencias** | **ninguna** (solo en "Frentes PPT · 01 Operación industrial" y "Transversal / comprador / ecosistema", 14 empresas) | — |

Dos cosas para decidir:
1. **Abastecimiento industrial** (repuestos críticos, ferreterías industriales, homologación) no tiene vertical en el CRM. ¿Se abandonó como tesis, o va como vertical 11 / dentro de "Transversal"?
2. "Transversal / comprador / ecosistema" (operadoras, contratistas: Tecpetrol, YPF, PECOM) ¿se muestra como línea o como "compradores" que cruzan todas las líneas? Propongo lo segundo.

Además, CONFIG tiene 6 "Frentes PPT" que agrupan las verticales. Pueden ser el nivel de arriba en Misión (6 frentes → 10 verticales), si te sirve para presentar.

## 8. Decisiones que necesito para seguir

1. ¿El CRM es la fuente de verdad de los datos de negocio y RELEVO no los edita? (recomendado)
2. ¿Suspendemos síntesis, objetivos, estado, Avanzar preparado, Morning Brief, vigilancia y estado de hallazgos? (ahorro ~USD 70/mes)
3. ¿Dónde deja el resultado tu Morning Brief externo y dónde deja Fireflies lo estructurado?
4. ¿Sincronización cada 2–3 minutos disparada desde la base (sin costo extra)?
5. ¿RELEVO puede escribir sus decisiones en una pestaña propia del Sheet, o lo dejamos solo lectura por ahora?
6. ¿Un Sheet por misión?
7. Verticales: ¿las 10 del CRM como líneas? ¿Qué hacemos con abastecimiento industrial y con "Transversal"?
8. ¿Ahora sí leemos las columnas de inversión de EMPRESAS y la pestaña OPORTUNIDADES completa?

Orden propuesto una vez decidido: (1) apagar los procesos duplicados, (2) leer las pestañas y columnas que faltan + huella por columnas + filas borradas, (3) sincronización frecuente, (4) C1 alimentado por el CRM.
