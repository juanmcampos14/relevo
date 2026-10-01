# 09 · CAMPO y RADAR: qué migrar antes del corte del Sheet

Estado: **propuesta** (01/10/2026). Nada migrado todavía. Leído del Sheet de hoy (modificado 01/10 13:42 UTC).

## Recomendación en una línea

Migrar **RADAR ahora** (crece todos los días y duplica al Morning Brief) y **CAMPO el 10/10**, después de cerrar la estrategia de AOG; fijar el corte del Sheet en dos pasos para no dejar inteligencia atrás.

## Qué hay hoy

| Pestaña | Filas | Qué contiene | Problema si queda en el Sheet |
|---|---|---|---|
| RADAR DE MERCADO | 38 (eran 24 ayer) | Señales de mercado e infraestructura, activos con precio actual / anterior / variación, housing (oferta, pipeline, capital), expositores AOG y 10 guiones de conversación AOG | Es un **segundo radar** alimentado a mano o por otro asistente: diverge del Morning Brief y sus precios no quedan con historia en RELEVO |
| CAMPO \| 16–26 OCT | 48 puntos | Agenda por día y bloque: entidad, tipo, hipótesis a contrastar, valor, dirección, contacto, horario, pregunta clave, estado | La agenda todavía se mueve (0 confirmados); sin ID por fila, no se puede reimportar sin duplicar |

## RADAR → RELEVO (propuesto: ahora, reejecutable por ID RAD-xxx)

| Grupo (prefijo) | Filas | Destino en RELEVO | Cómo |
|---|---|---|---|
| Activos con precio (RAD-ACT-01…09, RAD-HOU-04) | 10 | **Activos** (V17 + vertical de uso) con **historial de precios** (tabla nueva `asset_prices`: precio, moneda, fecha, fuente, «publicado»), partes con rol (broker, propietario) y evidencia como DECLARACIÓN del vendedor | Cada reimportación agrega un precio nuevo si cambió: es el Radar de precios que faltaba. Dos precios del mismo día en portales distintos = contradicción visible, no se promedia |
| Housing (RAD-HOU-01, 02, 03, 05) | 4 | Historia viva «Oferta de housing en Añelo» + evidencia vinculada a H-VA-09; los actores nuevos (Espacio Añelo, BIT Añelo, Hotel Housing YPF) entran como **candidatos** | Detectado ≠ validado |
| Mercado, infraestructura, operaciones, inversión, eventos, clima (RAD-001…003, CON, OPR, OPS, MKT, INV, EVT, WEA) | 10 | **Señales históricas del Morning Brief** (un brief de «migración del Radar del Sheet» con fecha y fuente de cada fila) y sus URLs como ya vistas | El brief deja de repetirlas como nuevas y las usa como contexto de historias |
| Expositores AOG (RAD-AOG-01…04) | 4 | Evidencia «expositor AOG 2026» vinculada a cada empresa del CRM (y candidatos si no está) | Fuente oficial AOG |
| Guiones AOG (RAD-AOG-10…19) | 10 | **Preguntas de entrevista** por empresa objetivo (cargo, qué aprender, apertura), vinculadas a la empresa y a su H-VA | Quedan en borrador hasta cerrar la estrategia de AOG (vertical → objetivo → hipótesis → interlocutor → pitch → preguntas → dato → siguiente paso) |

Esfuerzo: medio día (la tabla de precios es la única pieza nueva). Riesgo bajo: no toca empresas ni contactos.

## CAMPO → RELEVO (propuesto: 10/10, una vez)

| Columna del Sheet | Destino |
|---|---|
| Día / bloque | Jornada (`visit_plans`, una por día 16–26/10) |
| Entidad / persona | Parada (`visit_stops`) vinculada a la empresa del CRM. El Sheet usa **nombres, no IDs**: RELEVO propone el vínculo y se aprueba (los ambiguos, a revisión) |
| Hipótesis a contrastar · Pregunta clave | Vínculo a la H-VA y pregunta de campo de esa parada |
| Contacto | Ya está en el CRM (RED \| CONTACTOS); no se duplica, se vincula |
| Horario · Zona · Dirección · Estado | Datos de la parada |
| Hallazgo · Próxima acción | En campo se capturan en RELEVO (captura con ubicación → la visita) |

Por qué el 10/10 y no hoy: la agenda depende de la estrategia de AOG y de confirmar reuniones; migrarla hoy obligaría a mantenerla en dos lugares durante dos semanas. Pedido para que sea limpio: una **columna ID** en CAMPO (p. ej. C-1701-01) o lo genero yo por día + entidad.

## Corte del Sheet en dos pasos

| Paso | Cuándo | Qué pasa a vivir solo en RELEVO | Qué sigue en el Sheet |
|---|---|---|---|
| 1 | Al aprobar el CRM + migrar RADAR | Empresas, contactos (con borradores AOG), actividades, fuentes, hipótesis y preguntas, Radar y precios | CAMPO (agenda) |
| 2 | 10/10, antes del viaje | Agenda de campo | Nada: el Sheet queda de solo lectura como histórico |

Después del paso 1, el Radar del Sheet deja de alimentarse: lo que hoy se agrega ahí entra por el Morning Brief (o por captura en RELEVO), así no hay dos radares.

## Decisiones que necesito

1. ¿Migramos RADAR ahora con este mapeo (incluida la tabla de precios)?
2. ¿Quién alimenta hoy RADAR? Hay que avisarle que después del paso 1 deja de escribirse ahí.
3. ¿CAMPO el 10/10, con columna ID en el Sheet?
