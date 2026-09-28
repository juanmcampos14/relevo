# RELEVO — Plan v2: flujo rector para el Viaje 01 a Añelo

**Fecha:** 28/09/2026 · **Base:** feedback de Tano sobre la primera versión operativa · **Estado:** `propuesto` (no se programa hasta aprobación de Tano y Juan).

## 0. Principio rector

> La calle genera señales. RELEVO las estructura. La evidencia las valida. Nosotros decidimos.

Flujo: **Señal → Finding → Evidencia → Empresa/Persona → Visita → Hallazgo → Oportunidad → Decisión → Follow-up**.
Reglas que se mantienen: finding ≠ oportunidad; la IA estructura en silencio y siempre separa **hecho / inferencia / fuente**; nada se ejecuta sin humano; `can_approve_decisions` separado de admin (Tano ✔, Fran ✔).

Fechas: kickoff con Fran **lunes 5/10** · Viaje 01 **19–25/10** · hoy 28/09. Capacidad: 8 h/día.

---

## 1. Qué ya existe y se reutiliza (no se empieza de nuevo)

| Pieza actual | Se convierte en |
|---|---|
| Campañas + verticales + objetivos | **Misión** (Viaje 01) con fechas, objetivos e hipótesis |
| Findings + revisión + candidatas + decisiones | Mismo circuito; se agrega **captura rápida** como entrada y **votos** en decisiones |
| Visitas con notas | Visita **antes / durante / después** |
| Ficha de empresa/establecimiento/activo | **Company Intelligence Page** |
| Contactos (en ficha) | **Personas** con página propia y relación |
| Tareas | **Follow-ups** + "Próxima acción" visible en todo |
| audit_log + visitas + findings | **Timeline único** por empresa/persona/misión |
| Noticias (Bing) + RELEVO AI con herramientas | Base de la **central de inteligencia** (P1) y del procesamiento silencioso |
| Storage privado (patrón Run72), IA con citas y borradores | Fotos/audios y extracción con revisión |

## 2. P0 — para Añelo (congelando todo lo demás)

| # | Pedido | Qué se construye | Horas |
|---|---|---|---|
| 1 | Todos los clicks funcionando | Auditoría de **cada** botón/CTA/fila/link/breadcrumb/menú con destino, acción, permiso, vacío, loading, error, éxito. Lo inexistente queda *disabled + Próximamente*. Test E2E que recorre todos los links | 6 |
| 2 | Home ejecutiva | **HOY**: agenda del día con hora, empresa/persona, objetivo y Maps · **Para mirar hoy** (findings nuevos, follow-ups, decisiones, visitas sin procesar) · **Señales importantes** · **Market Pulse** (3–5 noticias, ver §5) | 6 |
| 3 | Misión / viaje | Campaña → Misión: fechas, objetivos, hipótesis (a validar / fortalecida / descartada). Hub con pestañas **Agenda · Mapa · Empresas · Personas · Findings · Visitas · Oportunidades · Decisiones** filtradas por misión | 10 |
| 4 | Mapa + cerca mío | Mapa embebido con pines por tipo (reunión, empresa a visitar, finding, oportunidad, activo, contacto, pendiente), "Abrir en Google Maps" y **Cerca mío** (GPS del teléfono, distancia y tiempo hasta la próxima reunión) | 10 |
| 5 | **+ Capturar** global | Botón fijo en todas las pantallas (una mano): texto, **foto** (cámara), **audio** (grabación en el navegador), **ubicación** automática, vínculo opcional a empresa/persona/visita. Guardar en 1 toque; se procesa después | 12 |
| 6 | Audio → estructura | Transcripción + extracción IA a **hechos / inferencias / evidencia (cita al audio) / problemas / números / personas / follow-ups / oportunidades potenciales**, todo como borrador para revisar. Respeta `ai_processing_consent` | 14 |
| 7 | Problemas repetidos | Etiqueta de **problema** normalizada en findings; "este problema apareció en N entrevistas" con enlaces; relación entre findings | 6 |
| 8 | Visitas antes/durante/después | **Antes**: quién es, qué sabemos, quién decide, por qué vamos, qué queremos aprender, preguntas sugeridas, Maps. **Durante**: notas, audio, fotos, personas. **Después**: resumen + hallazgos + decisión (*crear oportunidad / seguir investigando / descartar / escalar a Fran*) | 10 |
| 9 | Company Intelligence | Empresa · Personas por rol · **Qué sabemos** (confirmado) · **Qué creemos** (hipótesis) · Evidencia · Historial · Oportunidades · **Próxima acción** | 6 |
| 10 | Personas | Página propia: dónde trabaja, influencia, **relación** (Tano/Fran/Juan/referido por X/cold), quién lo conoce, último contacto, qué dijo, qué prometimos, pendientes, próxima acción. **Llamar / WhatsApp** con un toque | 8 |
| 11 | Timeline único | Vista cronológica por empresa, persona y misión (fuentes, visitas, audios procesados, findings, follow-ups, decisiones) | 4 |
| 12 | Oportunidad con evidencia | Campos: problema, quién lo tiene, frecuencia, costo actual, solución actual, competencia, disposición a pagar, modelo, economía preliminar, riesgos, **experimento siguiente**. Umbral visible de evidencia (N findings / N empresas) | 6 |
| 13 | Decision log | Decisión con evidencia enlazada, propuesta, **voto de cada aprobador** (avanzar / no avanzar / pedir más evidencia) con motivo, próximo paso, responsable y fecha límite. Opciones: investigar, validar, pilotear, invertir, comprar, partner, descartar | 6 |
| 14 | Follow-ups | Tareas → follow-ups con responsable y fecha; **próxima acción** visible en home, empresa, persona, oportunidad | 4 |
| 15 | Privacidad IA | `ai_processing_consent` por workspace + interruptor **Procesar con IA** (ON/OFF); sin consentimiento, audios se guardan sin enviarse a proveedores | 2 |
| 16 | Mobile una mano | Captura, próxima visita, Maps, llamar, WhatsApp, marcar visita realizada, follow-up; hojas inferiores en lugar de formularios largos | 6 |
| 17 | Arquitectura de inteligencia | Tablas `article_entities` y `signals` (noticia ↔ empresa/persona/finding/oportunidad) para no rediseñar en P1 | 4 |
| 18 | Prueba rectora | E2E automatizado + ensayo manual en celular (§4) | 8 |
| | **Total P0** | | **≈ 138 h** |

UI (sin rediseño): más cerca de Stripe × Linear × Notion — menos cajas, más jerarquía, menos texto explicativo permanente, estados claros, **Next Action** siempre visible. Se aplica mientras se tocan las pantallas, no como tarea aparte.

Navegación propuesta (5 destinos, IA fuera del menú): **Hoy · Misión · Mapa · Pipeline** (findings → oportunidades → decisiones) **· Directorio** (empresas + personas) + botón **+ Capturar**. RELEVO AI queda contextual ("preguntar sobre esto") y como procesamiento silencioso; noticias dentro de Hoy (Market Pulse) y de Pipeline.

## 3. Calendario propuesto (≈ 15 días hábiles hasta el viaje)

| Tramo | Fechas | Alcance | Horas |
|---|---|---|---|
| A — Kickoff | 29/09 → 5/10 | #1 clicks, #2 Home HOY, #5 captura (texto/foto/ubicación/audio guardado), #13 decision log con votos, #15 consentimiento, #16 mobile base | ~40 |
| B — Campo | 6/10 → 16/10 | #3 misión, #4 mapa + cerca mío, #6 transcripción y extracción, #7 problemas repetidos, #8 visita antes/durante/después, #9 empresa, #10 personas, #11 timeline, #12 oportunidad, #14 follow-ups, #17 | ~88 |
| C — Ensayo | 17/10 → 18/10 | #18 prueba rectora en celular (idealmente un recorrido real en Neuquén), correcciones | ~10 |

**Riesgo:** el total (~138 h) supera en ~15 h la capacidad hasta el 18/10. Si hace falta recortar, sale primero: animaciones/pulido visual, "cerca mío" con tiempos (queda distancia), y la relación automática entre findings (queda manual). **No** se recorta: captura, audio, visitas, decisiones, mobile, clicks.

## 4. Prueba rectora (criterio de "tenemos producto")

Tano ve una ferretería desde la camioneta → **captura** foto + audio + ubicación → RELEVO crea finding → identifica o crea empresa → Tano vuelve y habla con el dueño → registra **visita** → el audio genera **hechos + inferencias + evidencia** → aparece un **problema repetido** y se relaciona con otros findings → Tano crea **oportunidad** → Fran recibe contexto → **Fran decide** → se genera el **siguiente paso** → todo queda **auditado**.

## 5. P1 (durante/después del viaje) y P2

**P1:** Morning briefing ("Good morning, Tano": visitas, km, objetivo, personas, preguntas, pendientes, señales, ruta) · Cierre del día (Day 02) · envío por email (Resend con dominio verificado) · **Central de inteligencia**: más fuentes (Neuquén/Patagonia, nacionales, energía, LatAm, internacionales, comunicados, organismos, cámaras), deduplicación y agrupación por evento, categorías, resumen, "por qué importa", entidades, inversiones, relación con empresas/contactos/oportunidades, acciones desde la noticia (crear finding, relacionar, crear empresa/contacto, agregar al viaje, follow-up) · enriquecimiento · CSV · scoring · búsqueda semántica · automatizaciones.
**P2:** inteligencia cross-workspace, benchmarks, modelos de scoring, agentes, integraciones profundas, predicción.

## 6. Decisiones que necesito antes de arrancar

1. **Transcripción de audio** (P0 por la prueba rectora; Claude no transcribe audio). Propuesta: **Deepgram** (español; ~USD 0,26 por hora de audio, ya se usó en Jota) u **OpenAI** (~USD 0,18–0,36 por hora según modelo) — precios aproximados, a confirmar al contratar. Necesito elegir proveedor y clave.
2. **Mapa embebido**. Propuesta: **MapLibre + mapa base libre** (sin clave ni costo) con "Abrir en Google Maps" para navegar. Alternativa: Google Maps JS (clave y costo por carga).
3. **Señal vs finding vs hallazgo**. Propuesta: *Captura* = entrada cruda en segundos (foto/audio/texto/ubicación, sin procesar); *Finding* = afirmación estructurada con evidencia y revisión; *Hallazgo de visita* = finding que nace de una visita. ¿Coincide con lo que imaginan?
4. **Cierre de una decisión** con dos aprobadores: ¿hacen falta **ambos** votos (Tano y Fran) o alcanza con uno y el otro queda registrado? Propuesta: se cierra cuando votan todos los aprobadores; si hay desacuerdo queda "en discusión".
5. **Sin señal en ruta**: ¿Añelo tiene cobertura confiable? Si no, la captura necesita **cola offline** (guardar en el teléfono y subir al recuperar señal). Estimación extra: +8 h.
6. **Navegación**: ¿aprueban Hoy · Misión · Mapa · Pipeline · Directorio + Capturar, con RELEVO AI fuera del menú?
7. **Recorte si no llegamos**: ¿OK el orden de §3?
