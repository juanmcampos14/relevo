# RELEVO — Modelo canónico (fuente única de interpretación)

**Vigente desde:** 29/09/2026 · **Base:** Master + V9–V13 + decisiones de Tano del 29/09 · Si una decisión nueva contradice este documento, se actualiza acá **antes** de construir.

> RELEVO modela **Realidad → Evidencia → Aprendizaje → Decisión → Acción**. No es `Company → Contact → Deal`.

## North star (01/10/2026)

RELEVO no es un CRM que acumula información: es un **motor de aprendizaje y decisión en territorio**.
`mundo real → captura → evidencia → comprensión → validación → decisión → acción`

- **C** responde: *"Entendí lo que acabás de capturar."*
- **D** responde: *"Entiendo cómo esta evidencia se relaciona con todo lo que ya sabemos: qué fortalece, qué contradice, qué sigue siendo hipótesis, qué falta saber y cuál es la próxima validación que más valor aporta."*

Toda funcionalidad nueva se evalúa contra cinco preguntas: **¿qué sabemos? ¿qué creemos? ¿qué se contradice? ¿qué nos falta saber para decidir? ¿qué conviene hacer ahora y por qué?** Si no mejora alguna, no es prioridad. Reglas fijas: **IA propone → humano decide**; ninguna señal, hipótesis o finding pasa a oportunidad sin evidencia suficiente; más datos ≠ más inteligencia.

## 1. Objetos

| Objeto | Qué es | Ejemplo | Tabla |
|---|---|---|---|
| **Target** | Lo que investigamos en una misión: empresa, establecimiento o activo | YPF · Hotel Leonardo Da Vinci · un depósito | `companies` · `establishments` · `assets` + `campaign_targets` (etapa, prioridad, próxima acción dentro de la misión) |
| **Person / Contact** | Una persona identificada, o un canal institucional ("Compras de YPF") | Laura, Compras | `contacts` (`kind`: persona / canal institucional) + `contact_links` |
| **Conversation / Capture** | Lo que pasó en la realidad: material crudo (captura) o una interacción (visita, llamada, reunión) | Audio después de hablar con Pedro | `captures` · `visits` |
| **Evidence** | Una observación o dato atómico, con origen y nivel de verificación | "Tienen 40 camionetas" · "Las reparaciones en Neuquén les cuestan ~1 día" | `evidence` (nueva; absorbe `claims`) |
| **Finding** | Un aprendizaje o hipótesis que se sostiene (o no) con evidencia | "Posible fricción en reparación local de flotas" | `findings` + `finding_evidence` (con postura) |
| **Opportunity** | Candidato a negocio: problema + impacto + comprador + entrada viable | — | `opportunities` |
| **Decision** | Lo que resuelven Tano y/o Fran | — | `decisions` |
| **Next Action / Follow-up** | Qué hacer después, quién y cuándo | "Hablar con Laura sobre frecuencia y gasto" | `tasks` |
| **Source** | De dónde viene algo externo (URL, documento, CRM, feria) | Ficha pública, AOG 2026 | `sources` |

**Reglas duras**
- Una observación **no** es verdad; un finding **no** es una oportunidad; publicar un activo **no** es oportunidad; quien publica **no** es propietario.
- **La IA propone, un humano promueve.** Toda escritura que nace de IA o de una importación pasa por *aceptar / editar / rechazar*. Nada se promueve en silencio.

## 2. Promoción (IA propone → humano promueve)

`captura / fila importada / conversación con RELEVO AI` → **propuesta** (`proposals`) → revisión (aceptar · editar · rechazar) → objeto RELEVO.

Tipos de propuesta: persona, empresa, vínculo persona–empresa, evidencia, finding, oportunidad, próxima acción, unión de duplicados, normalización de un dato. Cada propuesta conserva de dónde salió (captura + fragmento, fila del Sheet o mensaje) y quién la decidió.

## 3. Evidencia

- **Verificación** (`verification_status`): `unverified` · `partially_verified` · `publicly_verified` · `field_verified` · `contradicted` · `stale`. Separado siempre de *qué dice* y *de dónde salió*. `demo` es la marca `is_demo`, no un estado. "Declarado por contacto" es un **origen** (`origin_kind = conversation`), no un estado.
- **Origen** (`origin_kind`): `field` · `interview` · `conversation` · `website` · `public_registry` · `press` · `aog` · `crm_import` · `email` · `manual` · `ai_research`.
- **Frescura:** cada evidencia tiene `evidence_type` y `revalidate_after`. En P0 el default es 30 días para todos los tipos. `stale` significa que la antigüedad o un cambio de contexto compromete su utilidad para la decisión actual. El modelo queda listo para `evidence_type → política de frescura → revalidación` (un precio no envejece igual que la propiedad de un activo).
- **Postura respecto de un finding** (`finding_evidence.stance`): `supports` · `contradicts` · `contextual`. La contraevidencia se muestra junto a la evidencia a favor, nunca escondida.

## 4. Procedencia ("¿de dónde salió esto?")

Todo objeto relevante responde: sistema y ID de origen (`external_refs`: `google_sheets` + `AN-0023`, archivo, pestaña, fila, lote de importación), captura original (audio/nota/foto y fragmento), persona que lo declaró, fecha, quién lo cargó, verificación, si pasó por IA (propuesta y corrida) y el historial de ediciones (`audit_log`). Se puede recorrer hacia atrás: **Finding → Evidence → Conversación/Captura → audio, nota o foto original**.

## 5. Importación desde Sheets

- Importar **no** es sincronizar. Lote → staging (fila original intacta) → propuesta por fila → revisión → escritura.
- `external_refs.last_values` guarda lo último importado de cada registro. Con eso se compara en tres sentidos: si solo cambió el Sheet, se propone actualizar; si solo cambió RELEVO, no se toca; si cambió el mismo campo en ambos lados, hay **conflicto** y se resuelve campo por campo. Un registro editado en RELEVO pasa a ser de RELEVO. Si algo desaparece del Sheet, no se borra.

## 6. Activos y roles

`asset_parties`: activo ↔ empresa o persona con rol `propietario` · `operador` · `intermediario` · `administrador` · `potencial_comprador` · `potencial_socio`, con su evidencia y verificación. Nunca se deduce el propietario de quien publica.

## 7. Etapas (idioma del CRM)

- **Target en la misión:** Investigación → Calificación → Contacto pendiente → Contactado → Reunión → Diagnóstico → Oportunidad · Descartado (con motivo).
- **Oportunidad:** Hipótesis → Investigación → Validación → Prueba → Revisión integral → Negociación → Aprobada → En ejecución · Pausada · Descartada. Pasar a Aprobada requiere decisión humana (`decide_opportunity`). *(La migración de etapas de oportunidad entra con el incremento D.)*

## 8. Opportunity readiness (arquitectura, sin puntaje visible)

Una oportunidad debe poder responder **"¿qué sabemos y qué nos falta saber para decidir?"** en seis dimensiones: **problema** · **evidencia** · **economía** · **compra** · **mercado** · **ejecución**. Implementación: evidencia vinculada con dimensión + preguntas abiertas por dimensión (`open_questions`). No hay score numérico hasta que haya evidencia real que lo justifique.

## 9. HOY

Prioridades determinísticas en P0. Brújula: **"¿qué debería hacer ahora y por qué?"**. A futuro combina urgencia, misión, evidencia pendiente, aprendizaje necesario, decisiones abiertas y siguiente mejor acción. HOY no es un dashboard.

## 10. Transición desde el modelo anterior

| Antes | Ahora |
|---|---|
| `claims` (lo que sabemos de una entidad) | `evidence` (se migran las filas) |
| Verificación `confirmado / declarado_por_contacto / fuente_publica_sin_verificar / hipotesis / demo` | `publicly_verified` (`field_verified` si viene de una visita) / `partially_verified` / `partially_verified` / `unverified` / `unverified` + `is_demo` |
| Estados del objetivo (`identificado … descartado`) | Etapas del CRM |
| Morning Brief y "pasar noticia a hallazgo" crean findings pendientes | Crean **propuestas de evidencia** (incremento D). Hasta entonces se mantienen como están |
| `ai_action_drafts` (borradores del chat) | Se unifican en `proposals` más adelante (hoy `proposals` cubre las capturas) |

## 11. Captura → propuestas → revisión (incremento C, implementado 30/09)

1. **Capturar** (texto, foto, ubicación; audio se guarda y se procesa cuando esté la transcripción). Con "Procesar con IA" y el consentimiento del workspace, el teléfono pide el procesamiento apenas la captura sube.
2. **Procesar** (`src/server/capture/process.ts`): una llamada a Claude (`claude-opus-5-5`, salida estructurada) con la nota, las fotos y las listas de empresas, contactos y findings existentes. Una sola corrida por captura; costo y tokens en `ai_runs`; límite diario por persona.
3. **Validar sin confiar en la IA** (`src/domain/capture-proposals.ts`): se descartan ids inexistentes, las citas deben aparecer textuales en la nota, los duplicados se buscan con las reglas del importador.
4. **Proponer** (`proposals`): empresa, personas (o canal institucional), evidencia (observada vs. declarada; relación con findings existentes a favor / en contra / contexto), posibles findings (con su evidencia a favor y en contra) y próximas acciones. Nada se escribe todavía.
5. **Revisar** (Capturas → captura): aceptar, editar o rechazar cada propuesta; vincular con una empresa o persona existente en lugar de crearla. Lo dependiente se decide en orden (empresa → persona → evidencia).
6. **Promover** (`src/server/capture/promote.ts`): cada aceptación crea el objeto con el mismo id de la propuesta (reintentar no duplica). La evidencia guarda la captura, la cita y quién la declaró; lo observado en persona queda "verificado en campo", lo declarado "sin verificar". Aceptar un finding es la promoción humana (queda aprobado) y se vincula a la evidencia aceptada. La frescura usa `settings.freshness_days` por tipo (30 por defecto).
7. **Trazar**: finding → evidencia (a favor / en contra) → captura original (nota, fotos, ubicación); la ficha de empresa muestra "Captura de campo" si nació de una.

## 12. Estado de un finding y próxima validación (incremento D, implementado 01/10)

**Pregunta:** ¿qué sabemos, qué no sabemos y qué conviene validar ahora? Sin puntaje visible.

- **Sin IA** (`src/domain/readiness.ts`): evidencia a favor / en contra / contexto, **casos independientes** (empresas distintas; si no hay empresa, persona, captura o fuente), verificada, desactualizada. De ahí salen faltantes deterministas: contradicción sin resolver, evidencia insuficiente, falta triangulación, evidencia desactualizada.
- **Con IA** (`src/server/findings/assess.ts`): 12 dimensiones —problema, actor afectado, frecuencia, impacto, usuario, comprador, decisor, solución actual, alternativas, condición de cambio, presupuesto, piloto— con estado *sabido / creído / contradicho / falta*, citando evidencia real. Que alguien lo declaró es "sabido" (como declaración); lo que se generaliza es "creído". Se controla: ids inexistentes fuera; "sabido" sin evidencia pasa a "creído"; "contradicho" sin evidencia en contra, también. De las dimensiones faltantes salen falta recurrencia / comprador / economía / solución actual.
- **Estado explicable**: faltantes con nombre y porqué (`GAPS`), en orden de prioridad.
- **Qué hacer ahora**: hasta 3 validaciones propuestas (`proposals` con `finding_id`), ordenadas por faltante; "Agendar" crea una tarea "Validación" vinculada al finding y su empresa; "Descartar" no deja nada. Nada se promueve a oportunidad.
- **Se re-evalúa solo** cuando se promueve un finding o le llega evidencia (desde una captura o vinculada a mano: "segundo caso"). El análisis queda marcado como desactualizado si cambió la evidencia.
- **HOY** consume esto con "por qué": contradicción abierta → validación por decidir → buscar segundo caso, después de lo vencido y de las visitas de hoy (agrupadas en una sola prioridad); bloque "Qué validar ahora".
- **Trazabilidad**: cada afirmación del estado cita evidencia [n]; cada evidencia enlaza a su captura (y al segundo del audio); la tarjeta del finding enlaza a su estado.

## 13. Qué cambia con cada evidencia y qué conviene aprender (incremento E, implementado 29/09)

**Pregunta:** ¿qué cambió en lo que sabemos, y cuál validación reduce más la incertidumbre que importa para decidir? Sin puntaje visible.

- **Observé ≠ una fuente afirma ≠ verifiqué**: la extracción distingue *observado*, *declarado por una persona* y *declarado por un documento* (cartel, aviso). Solo lo observado queda "verificado en campo"; lo declarado guarda quién lo declaró (`evidence.declared_by`) y se lee "35 m² — declarado por el aviso, observado en campo".
- **Activo propuesto y revisión agrupada**: una captura sobre un local/lote/galpón propone el activo con sus datos adentro; "Aceptar todo" acepta sujeto → personas → datos. El dato sigue atómico; la revisión, no.
- **E1 — efecto de la evidencia nueva** (`evidenceEffect`, `src/server/findings/effects.ts`): en la captura, "Qué cambió con esta captura" (y "si aceptás…"): primer caso, segundo caso ("deja de ser un caso aislado"), otro caso, mismo caso (refuerza, no triangula), contradice, contexto, o "no existe todavía un finding relacionado".
- **E2 — no duplicar findings**: la IA recibe los findings existentes y puede proponer vincular; además hay similitud de texto. En la revisión: "vincular a …" (por defecto) o "crear uno nuevo".
- **E3 — memoria de evolución** (`findingTimeline`, `trendSince`): en el finding, "Cómo llegó hasta acá" y "desde ayer se fortaleció / se debilitó / está en disputa".
- **E4 — valor de información** (`valueOfInformation`): entre todos los findings, primero resolver contradicciones, después comprador/economía cuando ya hay 2+ casos, después triangular un caso único, después profundizar. Cada prioridad explica **por qué** y **qué falta aprender**, y usa la validación ya agendada o propuesta.
- **HOY**: "Qué hacer ahora" (visitas de hoy, votos pendientes y las validaciones de mayor valor), "Qué cambió desde ayer", "Hipótesis abiertas"; aparte, **Higiene del sistema** (capturas sin procesar, propuestas por revisar, errores, pendientes vencidos). El mantenimiento no desplaza a las validaciones.

**Hablar con RELEVO (siguiente capa, no construida):** la conversación por voz será otra interfaz sobre este mismo motor —evidencia, relaciones, findings, contradicciones, faltantes, validaciones—. Lo dicho entra como una captura (audio → transcripción → propuestas → revisión humana) y las respuestas salen de las mismas funciones (`evidenceEffect`, `valueOfInformation`, estado del finding). No hay un segundo cerebro.

## 14. Captura ejecutiva, entidades sin identificar y evolución de hipótesis (30/09)

**Principio:** RELEVO completa el CRM mientras Tano entiende el territorio; Tano no trabaja para alimentar el CRM.

- **Revisión en dos niveles** (`src/domain/capture-review.ts`): primero "RELEVO entendió esto" (resumen, con quién habló, lo importante con su origen, qué todavía no sabemos) y "RELEVO propone" (qué se guarda o cambia, qué haría ahora) con **Aprobar propuesta**. Aprobar ejecuta las mismas escrituras que una por una, en orden de dependencias (empresa → activo → personas → evidencia → hipótesis → acciones), con la misma trazabilidad. Queda para decidir antes: posible duplicado de empresa, persona o hipótesis; reformular una hipótesis existente; identificar a alguien que estaba sin identificar. El detalle granular sigue abajo ("Revisar N elementos detectados").
- **Entidades sin identificar** (`unresolved_entities`): una organización sin nombre o una persona sin nombre ni empresa conocida no se crean en Empresas/Personas. Se guardan como organización o actor sin identificar (un actor puede pertenecer a una organización sin identificar), la evidencia apunta a ellas (`about_unresolved_id`, `stated_by_unresolved_id`) y cuentan como caso independiente. Cuando una captura revela quién era (la IA recibe la lista y propone `resolves`) o alguien lo indica en **Sin identificar**, se resuelven: la evidencia pasa a la empresa/persona real conservando a quién apuntaba, y se crean las relaciones (persona ↔ empresa). Un área de una empresa conocida ("Compras") sigue siendo canal institucional.
- **Evolución de hipótesis**: antes de proponer una nueva, la IA evalúa si lo nuevo **apoya, contradice, acota, amplía o segmenta** una existente. Acotar/ampliar/segmentar propone un enunciado refinado; al aceptarlo se reformula con `refine_finding` y queda en `finding_revisions` (un finding revisado sigue sin poder editarse a mano). La historia muestra "La hipótesis se segmentó: antes «…»".
- **Idea ≠ hipótesis ≠ finding** (`findings.maturity`): una idea de quien capturó queda como idea; aceptar una hipótesis de una captura la deja como hipótesis exploratoria; pasar a finding es una promoción humana registrada ("Promover a finding"). La oportunidad sigue siendo otra promoción posterior.
- **Límite de la API**: el formato de extracción está cerca del tope de gramática de structured outputs. Para hacer lugar, la relación evidencia ↔ hipótesis existente sale de las hipótesis candidatas (ya no de cada evidencia) y las citas son solo de la evidencia. Antes de sumar campos: `RUN_CONTRACT=1 npx vitest run src/server/capture/extract.contract.local.test.ts`.

## 15. Red: la memoria estructurada navegable (Bloque 1, 30/09)

- **Una entrada, sin módulos paralelos**: "Explorar" pasa a ser **Red** (misma ruta `/explorar`), con Misiones, Empresas y activos (con búsqueda), Personas (lista y ficha), Actividades, Evidencia, Sin identificar, Fuentes y Verticales. La ficha de empresa/activo sigue siendo el centro de cada entidad; ahora sus personas enlazan a la ficha de la persona y su evidencia muestra la procedencia y a quién apuntaba antes de resolverse.
- **Procedencia única** (`src/domain/provenance.ts`, `<ProvenanceTag>`): Campo (observado / declarado por…), RELEVO (CRM importado, carga manual), Web / fuente externa, Cálculo, Hipótesis, Desconocido. Se usa en evidencia, fichas y búsqueda; la usarán la economía, la vista ejecutiva y las respuestas de RELEVO.
- **Un solo modelo para CRM importado y campo**: el importador escribe sobre las tablas nativas con `external_refs` (IDs y procedencia del Sheet). Detecta duplicados de empresas y, ahora, de **personas** ya existentes en RELEVO (mismo email, teléfono o nombre): confirmar vincula el ID del CRM a la persona existente sin pisar sus datos y suma la relación con la empresa. Una captura posterior propone vincular con la empresa importada y su evidencia queda en esa ficha. El Sheet es semilla: RELEVO pasa a ser la fuente de verdad operativa y las reimportaciones solo proponen cambios (diff de tres vías, sin escritura silenciosa).
- **Búsqueda** incluye personas (a su ficha), hipótesis/findings, evidencia y entidades sin identificar.
- **Captura en el teléfono**: el botón es un círculo compacto sobre la barra inferior; en escritorio va en la barra superior (no tapa contenido).

## 16. Casos en estudio y Vista Ejecutiva (Bloque 2, 30/09)

- **Sin entidad nueva**: un caso en estudio es un nivel más de madurez de la misma hipótesis (idea → hipótesis → finding → caso), con su evidencia, contraevidencia e historia; la oportunidad sigue siendo la promoción posterior (`opportunity_findings`). Etapa explicable (`src/domain/case.ts`): señal (un caso) → en validación (2+ casos o finding) → caso en estudio → oportunidad.
- **Economía** (`src/domain/economics.ts`, `finding_assessments.economics`): la evaluación registra por variable (usuarios, frecuencia, volumen, precio, pagador, comprador, proveedor actual, contrato, CAPEX, OPEX, margen, condición de cambio) el valor, su base (observado / declarado / calculado con fórmula / estimado) y la evidencia citada. Control determinista: sin evidencia no hay observado ni declarado; sin fórmula no hay calculado. Lo que no figura es desconocido.
- **Criterios de oportunidad** (sin puntaje): problema concreto, evidencia suficiente (2+ casos independientes y sin contradicción abierta), actor afectado, comprador o decisor identificable, economía que no sea estimación y próximo hito verificable. Se muestran en el caso y en la vista ejecutiva; no promueven nada solos.
- **Ficha del caso** ("Como posible negocio"): problema, quién lo sufre, quién podría pagar o decidir, solución actual (sabido / supuesto / desconocido, con evidencia), economía conocida, desconocidos, criterios y **Pedir ayuda** (tarea "Ayuda" para otro miembro: contacto, introducción, acceso, validación).
- **Vista Ejecutiva** (misma home, otra lectura): esperan tu decisión, qué sabemos (madurez, fuentes independientes, contraevidencia, actualización), dónde podría haber negocio (qué le falta a cada caso), economía descubierta (con su base), qué cambió nuestra lectura (antes / nueva evidencia / ahora / implicación), qué todavía no sabemos y decisiones y ayuda requerida. Sin conteos de actividad.

## 17. RELEVO conversacional y ajustes P0 (Bloque 3, 01/10)

- **Procedencia en dos dimensiones** (`src/domain/provenance.ts`): canal de origen (campo, entrevista, CRM/importación, web/fuente externa, documento, RELEVO, sistema, desconocido) × base de la afirmación (observado, declarado, documentado, calculado, inferido, propuesto por IA, no determinado). La IA nunca es la fuente. "Evidencia suficiente" = una fuente directa o documental fuerte (observada, o documentada y verificada) o más de una fuente independiente, sin contradicción abierta.
- **Conversación como evento único**: al procesar, huella del audio (sha256) y del texto normalizado; mismo audio, mismo texto o casi idéntico (≥ 0,75) → la captura queda como "misma conversación que…" sin extraer ni contar como fuente nueva. "Es otra conversación" la procesa igual.
- **Identidad**: email y teléfono son fuertes; el nombre solo sugiere ("solo coincide el nombre: confirmá con la empresa o el cargo"); nombre + empresa es sugerencia fuerte; nunca se fusiona solo.
- **Corte del Sheet** (Integraciones): el Sheet es fuente activa hasta la fecha de corte; el corte exige una reconciliación completa aplicada desde esa fecha y confirmación del owner; después el importador no escribe (reapertura excepcional con motivo). Historial en `settings.sheet_cutover`.
- **Caso**: estado activo / pausado / cerrado / descartado y madurez reversible, siempre con motivo (en la historia). Los inactivos no compiten en HOY.
- **Pedidos de ayuda** (`help_requests`): quién pide, a quién, caso, tipo (contacto, introducción, acceso, validación, aprobación, capital, conocimiento), a quién se busca, fecha, estado y resultado. Se responden desde la Vista Ejecutiva.
- **RELEVO en todas las pantallas** (`AssistantPanel`): panel lateral en escritorio y pantalla completa en el teléfono (botón RELEVO de la barra inferior). Entiende la pantalla actual (empresa, activo, persona, hipótesis, captura, oportunidad, misión) y consulta toda la memoria con herramientas de conocimiento (`find`, `list_hypotheses`, `get_hypothesis`, `get_capture`, `get_person`, `changes_since`, `quality_checks`, `upcoming_agenda`, `pending_for_team`, `list_members`, `open_page`). Responde separando hechos, declaraciones, cálculos, inferencias, contradicciones y desconocido, con citas navegables. Dictado de la pregunta por voz y acceso directo a Capturar.
- **Niveles de acción**: leer → navegar (`open_page`) → proponer (`propose_action`) → ejecutar solo con aprobación. Cada propuesta tiene vista previa (qué cambia, sobre qué, por qué, evidencia, riesgo de duplicado, resultado esperado) y al ejecutarse guarda estado anterior y posterior, quién y cuándo (`ai_action_drafts`). Tipos cerrados: tarea, validación, vincular evidencia, próxima acción, pedido de ayuda, hipótesis pendiente, pedir decisión. No existen acciones para promover oportunidades, fusionar personas, confirmar reuniones, enviar mensajes, modificar economía ni descartar casos.
- **Calidad** (Red → Calidad y herramienta del asistente): alarmas concretas con enlace para arreglar.
- **Discovery log**: `docs/05-operational-discovery-log.md`.

## 18. Una cabeza, una memoria, una conversación (ciclo previo al viaje, 02/10)

- **Misión ≠ proyectos** (`campaigns.kind`): la misión (Añelo / Vaca Muerta) es una y transversal; Mountain Suites, Hielo o un terreno son proyectos con la misma estructura (entidades, capturas, hipótesis, tareas). Capturar o hablar con RELEVO desde un proyecto lo alimenta; si no, alimenta la misión.
- **Home = cabina de misión**: misión → RELEVO está viendo (ganó fuerza, perdió fuerza, en disputa, hipótesis nuevas, lo que no sabemos) → Qué haría ahora → Oportunidades activas (proyectos, casos, oportunidades) → Higiene. Sin métricas de actividad.
- **"Le cuento"** (`record_field_note`): lo que se le cuenta a RELEVO de campo se guarda como captura original (con la ubicación del teléfono y el proyecto activo), se procesa (con el tema de la conversación como contexto) y vuelve en el chat como "RELEVO entendió esto" con Aprobar · Revisar detalle · Ignorar. Una observación es una señal, no un hecho general.
- **Cifras con unidad** (`evidence.value_*`, `src/domain/quantities.ts`): USD/ARS, m², personas, % con notación argentina; USD/m² y comparación contra referencias son cálculo determinista. Un precio aprobado sobre un activo sin precio completa el activo (la historia queda en la evidencia).
- **Afuera cuando hace falta**: búsqueda y lectura web del lado de Anthropic (`web_search_20260209`, `web_fetch_20260209`) con citas; lo que sirve se guarda con aprobación como fuente + evidencia (canal web · base documentado) (`record_web_evidence`).
- **Territorio**: mapa (Leaflet + OpenStreetMap) con nuestra memoria (activos, empresas, capturas), radios y lugares reales por categoría; herramientas `locate`, `places_nearby`, `memory_nearby`, `show_map`. Lugares: Google Places si hay `GOOGLE_MAPS_API_KEY` (mejor cobertura de comercios chicos), si no OpenStreetMap con servidores espejo. Siempre se dice la fuente y su límite: cero resultados no es cero oferta.
- **"¿Dónde quedamos?"** (`project_status`): objetivo, entidades, hipótesis y su estado, capturas, tareas hechas y pendientes, pedidos de ayuda.
- **Prueba de producto** (`e2e/discovery-ferreteria.spec.ts`, `RUN_CONTRACT=1`): "caminé cinco horas y vi una sola ferretería" → captura con ubicación → memoria + territorio (OSM: 0, dicho como límite) + web (6 puntos de venta con dirección) → lectura que reformula la señal → hipótesis → "hablé con el dueño…" se relaciona con la hipótesis abierta y la acota (faltan repuestos hidráulicos, no ferreterías), con contraevidencia web (Hidroil) para aprobar.

## 19. Morning Brief V1 (07/10)

- **Un objeto, varias salidas**: `briefs` (uno por workspace y día, `brief_id`) guarda período, versión, notas recolectadas, memo de investigación, contenido estructurado, motores usados y costo. La pantalla `/brief` y el email son dos renders del mismo `content`; los destinatarios reciben exactamente el mismo brief.
- **Pipeline por pasos** (`src/server/brief/pipeline.ts`): recolectando → investigando → sintetizando → generado → envíos. Cada paso corre en su propia invocación (la ruta `/api/cron/brief` se encadena a sí misma) y es reintentable sin repetir los anteriores. Vercel Cron la llama 3 veces por la mañana: la primera arranca, las otras retoman lo que haya fallado.
- **Fuentes**: Vaca Muerta News es prioritaria (portada → notas completas, sin RSS; parser puro testeado); Google Noticias cubre medios regionales, oficiales y corporativos; la investigación completa con búsqueda y lectura web. `brief_source_items` evita que una URL vuelva a entrar como nueva.
- **Motores intercambiables** (`engines.ts`): `ResearchEngine` y `SynthesisEngine` son la frontera; hoy Claude. La síntesis devuelve JSON con su esquema en el prompt (el contrato excede el límite de gramática de las salidas estructuradas) y se valida con `WireDraft`; vertical y tipo se normalizan contra la lista controlada (texto libre nunca crea una vertical).
- **Memoria longitudinal**: `brief_stories` (historias vivas; `watchlist` con motivo, no reinicia cada mañana) y `brief_signals` (hecho / declaración / inferencia, cambio nuevo/actualizado/confirmado/contradicho/descartado, cruces verificados con empresas, hipótesis, proyectos y activos). Radar de verticales y "qué cambió" se derivan sin IA.
- **Candidatos**: `brief_candidates` detectado → candidato → aprobado/descartado → incorporado. Nunca alta automática; ni lo que ya está en el CRM ni lo ya propuesto vuelve como candidato.
- **Entrega**: `EmailProvider` (hoy Resend, clave de idempotencia por brief y destinatario). `brief_deliveries` registra destinatario, proveedor, estado, error, intentos y hora. Si falla el email, el brief queda generado y se reintenta solo el envío.
- **RELEVO lo usa**: herramienta `morning_brief` en la conversación; bloque en Inicio.
