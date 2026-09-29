# RELEVO — Modelo canónico (fuente única de interpretación)

**Vigente desde:** 29/09/2026 · **Base:** Master + V9–V13 + decisiones de Tano del 29/09 · Si una decisión nueva contradice este documento, se actualiza acá **antes** de construir.

> RELEVO modela **Realidad → Evidencia → Aprendizaje → Decisión → Acción**. No es `Company → Contact → Deal`.

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
