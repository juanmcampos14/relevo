# RELEVO OS — Paso 0: auditoría, diseño y estimación P0

**Fecha:** 28/09/2026 · **Autor:** Claude (copiloto) para Juan y Tano · **Estado de todo lo descrito:** `propuesto`. Nada está implementado ni probado.

> **v2 (28/09):** caso piloto multivertical (`Añelo — Discovery 2026`, 3 casos reales) en lugar de Estaciones de servicio; nueva entidad `assets` (inmuebles, terrenos, fondos de comercio); secuencia `Research → Finding → Verificación → Revisión → Opportunity Candidate → Aprobación → Dealflow`; IA fuera de P0; `can_approve_decisions` independiente del rol. Decisiones aprobadas por Tano/Juan listadas en §6.

Nombre de la plataforma: provisional. `Daicou` = primer workspace/cliente (piloto Tano + Fran). Carpeta del proyecto: `~/Developer/Projects/Daicou`.

---

## 1. Resumen del producto y del caso real

Plataforma multi-workspace para originar e investigar oportunidades de negocio y ejecutarlas: `Campaign → Vertical → Entity/Asset → Source → Finding → Visit → Review → Opportunity (candidata) → Decision → Dealflow`. Piloto: workspace **Daicou**, campaña **Añelo — Discovery 2026**, varias verticales (gastronomía, fitness, alojamiento, servicios, comercios, inmuebles y tierra, fondos de comercio, logística — configurables), probado con **3 casos reales** que aporta Tano. El research externo (Morning Brief) también produce Findings trazables; un Finding **nunca** se convierte solo en Opportunity. Tano (owner, campo) y Fran (admin, ejecutivo) ven los mismos datos con inicios distintos. La IA propone, el humano aprueba; ningún dato sin procedencia. El negocio de Tano con Fran ≠ el software de Tano y Juan.

---

## 2. Auditoría de repositorios

Todos los repos son privados, sin archivo LICENSE, con commits de Juan → propiedad propia, reutilizables. Ningún secreto está versionado (los `.env*` están en `.gitignore`); **no se copia ningún `.env` ni dato de clientes**.

| Repo / componente | Ruta · commit | Stack | Tests | Estado | Decisión | Horas ahorradas (P0 / total) |
|---|---|---|---|---|---|---|
| **RUN72-monorepo** · paquetes `shared-domain`, `organizations`, `roles`, `auth`, `audit`, `settings` | `~/Developer/Projects/RUN72-monorepo` · `e1d6432` (15/07) | TS puro, ports `SqlExecutor`/`SessionPort`, migraciones SQL propias | 24 tests en `apps/stay` pasan; **0 tests en los paquetes**; tsc, tenant-sql y layers en verde | Prototipo sólido, pequeño (~800 LOC) | **Adaptar**: `organizations`→`workspaces`, añadir capacidades (`can_approve_decisions`) al rol, guard `requireCapability`, selector de workspace | 12 / 20 |
| RUN72-monorepo · `tooling/` (migrate checksummed, guard tenant-SQL, **harness de tests RLS** con pg efímero, CI) | ídem | Node scripts, GitHub Actions | se ejecutan | Maduro | **Reutilizar** | 6 / 8 |
| RUN72-monorepo · `event-kit`, `worker-runtime`, `timeline` | ídem | outbox, SKIP LOCKED, proyección de timeline | sin tests propios | Real | **Reutilizar en P1** (timeline de ficha 360 puede entrar en P0 simplificado). Arreglar: reclamar eventos atascados en `processing`; cron que hoy **falla abierto** si falta `CRON_SECRET` | 2 / 17 |
| RUN72-monorepo · `consent` | ídem | ledger con trigger granted→revoked | — | Real, acoplado a `guest_id` | **Adaptar en P1** (sujeto genérico = participante de reunión) | 0 / 4 |
| RUN72-monorepo · `identity` | ídem | normalización teléfono/email, fuzzy match | — | Real | **Aislar**: base para deduplicación (P1 importador) | 1 / 2 |
| RUN72-monorepo · `guest`, `analytics`, `apps/stay`, UI kit | ídem | — | — | Dominio hotelero | **Descartar** (solo snippets de sesión SSR/middleware) | 1 / 3 |
| **Jota** (`jc-platform`) · `src/integrations/ai` (gateway, adaptador Anthropic, routing, telemetría de costo) | `~/Developer/Projects/JC/jc-platform` · `408a1cb1` (26/09) | Next 16, Supabase, shadcn, Anthropic SDK | 680 archivos de test (unit/arquitectura) | Maduro en diseño; sin zod; telemetría solo en memoria | **Adaptar**: copiar solo el puerto + adaptador Anthropic, añadir zod y persistir `ai_run` | 0 (P0 sin IA) / 12–16 |
| Jota · auth (reset, verify, password policy), middleware, `lib/access` (capacidades fail-closed) | ídem | — | alto | Maduro, pero conviven dos modelos de permisos | **Adaptar como referencia**: flujos de auth; modelo de permisos se toma de RUN72-monorepo (más simple) | 4 / 10 |
| Jota · `SupabaseQueue` + outbox + crons | ídem | — | sí | Maduro | **Posterior** (se usa event-kit o esto en P1, **no ambos**) | 0 / 8 |
| Jota · `emailmkt/csv-import.ts`, dedup de ingesta (`crm/ingesta-logica.ts`, migración 172) | ídem y rama `crm-ingesta` | — | sí | Maduro, dominio leads | **Adaptar en P1** (importador CSV) | 0 / 8–12 |
| Jota · patrón `sales/analyze.ts` (hechos / inferencias / desconocidos / evidencia / needs_human) | rama `crm-ingesta` | — | — | Buen patrón | **Adaptar** para la extracción de hallazgos | 0–2 / 3–5 |
| Jota · Resend adapter, ResponsiveTable/MasterDetail/ConfirmDialog, `verify.mjs`, reglas semgrep | ídem | — | — | — | **Adaptar** (componentes y guardas) | 3 / 8 |
| Jota · CRM (acoplado a Twenty), studio, ads, SEO, billing, workers, voice-worker LiveKit | ídem | — | — | Dominio marketing | **Descartar** (voice-worker es tiempo real, no subida+transcripción) | 0 |
| **Run72** (app) · `lib/storage.ts` (URLs firmadas), clientes Supabase, patrón de salida estructurada del LLM | `~/Developer/Projects/Run72` · `eca032e` (08/07) | Next 16, sin tests | 0 | Prototipo de agencia | **Reutilizar** storage (P1); resto **descartar**. RLS activado sin políticas + service role en todo → no se replica | 1 / 5 |
| Run72 · `run72-os` (metodología) y `Run72/Run72 Core` (dominio Workspace + CI) | ídem | docs + TS puro | vitest | Metodología útil; catálogo de "componentes compartidos" es **aspiracional** (no existen en código) | **Referencia** | 1 / 3 |
| `~/Developer/Projects/Run72 Core` | — | — | — | Vacío | — | 0 |
| **Aikestar Replica** | `~/Developer/Projects/Aikestar/Aikestar Replica/app` · sin git (export Replit) | Vite + Express + Drizzle | ~85 | Stack incompatible | **Descartar**; campos de oportunidad como referencia | 1 / 3 |
| partners-platform (JC) | `~/Developer/Projects/JC/partners-platform` · `8183d2c` | Next + Prisma + JWT propio | 5 | Otro dominio | **Descartar** | 0 |
| Tips+, Margin (`~/Developer/Projects/Tips`, `margin-platform`) | — | — | — | **Sin auditar** (run72-os dice que allí viven Organizations/Roles; RUN72-monorepo ya los cubre) | Auditar solo si Juan lo pide | — |

**Ahorro realista sin doble conteo:** ~30 h sobre P0 y ~110 h sobre P0+P1. La base de multi-tenant con RLS + harness de pruebas de aislamiento es lo que más vale: es lo más caro de hacer bien desde cero.

**Hallazgos de seguridad en repos existentes (fuera de alcance, para Juan):** cron de RUN72-monorepo falla abierto sin `CRON_SECRET`; Run72 tiene email de admin hardcodeado por defecto y `mp_access_token` en tabla en texto plano; partners-platform acepta `AUTH_SECRET` vacío; Jota tiene 12 `probe-*.mts` sin versionar que usan service role y despliega a producción en cada push sin CI.

### Arquitectura resultante (propuesta)

Repo nuevo en `Daicou` (no fork). Next.js App Router + TS + Tailwind + shadcn/ui + Supabase (Postgres/Auth/RLS/Storage) + Vercel, Supabase CLI para migraciones + runner/guards de RUN72-monorepo, zod en todos los bordes.
**Diferencia clave respecto a los repos auditados:** las lecturas/escrituras de usuario van con el **JWT del usuario** (RLS efectiva). El service role solo en jobs de servidor explícitos. Capas: `domain/` (reglas puras) · `app/` (UI + server actions) · `db/` (repositorios) · `integrations/` (IA, mapas, email; P1+).

---

## 3. Modelo de datos (P0 marcado ●, P1 ○)

Todas las tablas tenant llevan `id uuid`, `workspace_id`, `created_by`, `created_at`, `updated_at`, RLS por membresía.

**Tenancy y seguridad**
- ● `workspaces` (nombre, slug, configuración de etiquetas) · ● `memberships` (user_id, workspace_id, role `owner|admin|member|viewer`, `can_approve_decisions bool`) · ● `workspace_invitations` · ● `user_preferences` (home widgets, intereses; **no autorizan nada**) · ● `audit_log` (append-only, trigger)

**Investigación**
- ● `campaigns` (nombre, zona, fechas, estado `borrador|activa|pausada|finalizada`, objetivos)
- ● `verticals` (nombre, tesis, problema buscado, owner) · ● `campaign_verticals`
- ● `campaign_targets` (campaign_id + **exactamente uno** de company_id / establishment_id / asset_id vía CHECK, target_status `identificado|por_investigar|por_contactar|contactado|visita_programada|visitado|seguimiento|descartado`, prioridad, próxima acción)
- ● `target_verticals` (N:M: un target en varias verticales sin duplicarse)

**Entidades canónicas**
- ● `companies` (razón social, nombre comercial, tipo, estado de verificación)
- ● `establishments` (company_id, nombre, dirección, localidad, provincia, lat/lng **solo si verificadas**, `address_status`) → el target apunta a un establecimiento (o a empresa sin establecimiento)
- ● `assets` (tipo `inmueble|terreno|local|fondo_de_comercio|otro`, operación `venta|alquiler|asociación|desconocida`, dirección/ubicación con `address_status`, superficie, precio publicado **+ moneda + fecha + source_id** o vacío, company_id del titular solo si consta, establishment_id si el fondo de comercio es un local existente)
- ● `contacts` (nombre, cargo, canal, email/teléfono solo si legítimos, permiso de contacto) · ● `contact_links` (contacto ↔ empresa/establecimiento/asset, rol)
- ● `sources` (kind `url|documento|contacto|observación|drive|research_externo`, url canónica, título, medio, `published_at`, `captured_at`, autor/ingestor) · ● `claims` (afirmación, entidad, source_id, `verification_status`, próximo paso de verificación)

**Campo**
- ● `visit_plans` (fecha, owner, campaña) · ● `visit_stops` (orden manual, target, hora objetivo, estado `programada|confirmada|realizada|no_realizada`)
- ● `visits` (stop/target, fecha, interlocutor, consentimiento registrado, notas manuales) — en P1 se extiende a `meeting` + `meeting_media` + `transcript`

**Revisión y CRM**
- ● `findings` (**source_id obligatorio**, visit_id opcional, entidad vinculada company/establishment/asset opcional, campaña/vertical, tipo `hecho_declarado|observación|necesidad|riesgo|pregunta|señal_de_mercado|oferta_publicada`, texto, evidencia/cita, análisis, origen `manual|research_externo|ia(P1)`, `verification_status`, `review_status` `pendiente_revision|aprobado|rechazado`, revisor, fecha, `dedup_key` para ingesta idempotente)
- ● `opportunities` (título, vía `adquisición|participación|gestión|alianza|creación_propia`, **`status` `candidata|aprobada|rechazada|descartada`**, etapa de dealflow — solo si `aprobada` —, próxima acción, owner, aprobada_por/fecha) · ● `opportunity_links` (N:M a empresas, establecimientos, assets, contactos, findings, visitas)
- Regla: una Opportunity solo nace como `candidata` desde findings **revisados**, por acción humana; pasa a `aprobada` (entra al dealflow) solo por un usuario con `can_approve_decisions`, registrando una `decision`. Si todos sus findings de soporte están sin verificar, la UI lo advierte (no lo bloquea).
- ● `tasks` (estado `todo|in_progress|blocked|done`, responsable, vencimiento, entidad vinculada, `finding_id` de origen)
- ● `decisions` (pregunta, contexto, estado `requested|approved|rejected|deferred`, decidió, fecha) · ● `comments` (polimórfico: sobre decisión, oportunidad, briefing)
- ● `briefings` (alcance `conjunto|personal`, periodo, contenido, referencias a registros, estado `borrador|publicado_en_app`)
- ○ `ai_runs`, `ai_action_drafts`, `import_jobs`, `import_rows`, `news_articles`, `meeting_*`, `projects`, `phases`

Catálogo único de `verification_status`: `confirmado · declarado_por_contacto · fuente_publica_sin_verificar · hipotesis · demo`. El estado de datos pedidos en diligencia (`solicitado/recibido/verificado/pendiente`) es un catálogo distinto, P1.

Secuencia de originación: `Research/Visita → Finding → Verificación → Revisión humana → Opportunity candidata → Aprobación (decision) → Dealflow`.
Dealflow único (configurable por workspace, solo oportunidades aprobadas): `contacto_identificado → primer_contacto → entrevista_visita → en_validacion → pre_diligencia → diligencia → propuesta_negociacion → piloto_acuerdo → operacion` + `pausada`, `descartada` (con motivo).

Ingesta del Morning Brief (**P1**, esquema listo en P0): endpoint server-side autenticado por workspace que recibe findings con fuente/URL/fecha/evidencia/entidad sugerida, deduplica por `dedup_key` (URL canónica + entidad), los crea en `pendiente_revision` y nunca crea oportunidades. En P0 esos findings se cargan a mano desde la bandeja.

---

## 4. Flujo de pantallas (5 destinos)

```
Inicio ─────────── Tano: 3 prioridades · próximas paradas · hallazgos por revisar · tareas · [Registrar visita]
                   Fran: decisiones pendientes · oportunidades activas · último briefing · novedades
                   (misma data, widgets distintos vía user_preferences)

Explorar ───────── Campaña ▸ Vertical ▸ lista de targets (filtros por estado y tipo)
                     └─ Ficha de empresa/establecimiento/asset: identidad+fuentes · ubicación [Abrir en Maps]
                        · contactos · visitas · hallazgos · oportunidades · timeline · [Registrar visita]

Agenda y mapa ──── Jornadas ▸ paradas ordenadas ▸ [Abrir en Google Maps] por parada / multi-parada
                     └─ Visita: interlocutor · consentimiento · notas ▸ [Proponer hallazgos]

Oportunidades ──── Bandeja de findings (visitas + research externo): verificar · aprobar/rechazar
                     └─ desde finding aprobado: [Crear tarea] · [Proponer oportunidad candidata]
                   · Candidatas ▸ [Aprobar → dealflow] (solo can_approve_decisions, registra decision)
                   · Dealflow (lista) ▸ Ficha 360 · Decisiones · Briefings

RELEVO AI ──────── P0: pantalla "No disponible todavía" explícita. P1: chat acotado al workspace.
```
Búsqueda global en el topbar. Móvil: barra inferior con los 5 destinos. Vertical → registrar visita en ≤3 toques.

---

## 5. Matriz requisito → prioridad → módulo → entidad/API → prueba

| # | Requisito | Prio | Módulo | Entidad / API | Prueba de aceptación |
|---|---|---|---|---|---|
| 1 | Login, invitación, roles, `can_approve_decisions` | P0 | auth/tenancy (RUN72 adaptado) | memberships, invitations | Tano y Fran entran; Fran admin; viewer no edita |
| 2 | Aislamiento de workspaces | P0 | RLS + harness | todas | usuario de B no lee/escribe A por UI, API ni DB (test RLS automatizado) |
| 3 | Preferencias ≠ permisos | P0 | home | user_preferences | cambiar home de Fran no cambia lo que puede abrir |
| 4 | Campaña `Añelo — Discovery 2026` multivertical | P0 | explorar | campaigns, verticals | crear campaña con varias verticales, recargar, Fran lo ve |
| 5 | Fichas empresa/establecimiento/**asset**/contacto/fuente con verificación | P0 | explorar | companies, establishments, assets, contacts, sources, claims | un target en 2 verticales sin duplicado; precio publicado sin fuente/fecha no se guarda; claim sin fuente no se puede marcar `confirmado` |
| 6 | Carga manual estructurada | P0 | explorar | ídem | formulario rápido con validación zod |
| 7 | Jornada + enlace Google Maps | P0 | agenda | visit_plans, visit_stops | URL `maps/dir/?api=1` bien codificada; sin dirección verificada → advertencia, sin ruta |
| 8 | Visita con notas manuales y consentimiento | P0 | agenda | visits | persiste tras recargar; sin consentimiento no hay grabación (P0 no graba) |
| 9 | Findings trazables (visita o research externo) + revisión humana | P0 | oportunidades | findings, sources | finding sin fuente no se guarda; aprobar un finding **no** crea oportunidad; "crear candidata" desde finding revisado la crea **una sola vez** aun con doble clic; rechazar no crea nada |
| 9b | Candidata → aprobación → dealflow | P0 | oportunidades | opportunities, decisions | sin `can_approve_decisions` no se puede aprobar; aprobar registra decision + audit_log y recién ahí aparece en dealflow |
| 10 | CRM: oportunidad, tarea, pipeline | P0 | oportunidades | opportunities, tasks, opportunity_links | cambio de etapa auditado con autor y hora |
| 11 | Decisión/comentario de Fran | P0 | oportunidades | decisions, comments | solo `can_approve_decisions` aprueba; queda en audit_log |
| 12 | Briefing interno compartido | P0 | oportunidades | briefings | generado desde registros con referencias clicables; sin actividad → "Sin nuevos avances registrados"; nunca "enviado" |
| 13 | Funciones no disponibles identificadas | P0 | UI | — | RELEVO AI, importador, audio, noticias muestran "no disponible" |
| 14 | Auditoría y timeline de ficha | P0 | audit | audit_log | ficha muestra historial |
| 15 | Export CSV básico | P0- | explorar | — | exporta targets de una vertical |
| 16 | Extracción IA de notas | P0 si hay clave / si no P1 | integrations/ai (Jota adaptado) | ai_runs, findings(origen=ia) | cita a nota; nada sin sustento; inyección en nota no ejecuta acciones |
| 17 | Importador CSV desde Sheets | P1 | import (Jota csv + identity) | import_jobs, import_rows | importar 2 veces = 0 duplicados; archivo malformado rechazado sin corrupción |
| 18 | RELEVO AI conversacional | P1 | ai | ai_conversations, ai_messages, ai_action_drafts | responde solo con registros citados; admite no saber |
| 19 | Ingesta Morning Brief → findings; noticias / digest | P1 | intelligence | findings(origen=research_externo), sources | mismo ítem enviado 2 veces = 1 finding; nunca crea oportunidad; feed caído muestra error |
| 20 | Audio + transcripción | P1 | meetings | meeting_media, transcript | fallo de transcripción conserva reunión |
| 21 | Mapa embebido, geocodificación | P1 | agenda | establishments.lat/lng | — |
| 22 | Proyectos, roadmap F0–F6, convertir oportunidad→proyecto | P1 | projects | projects, phases | conserva historial |
| 23 | OAuth Drive/Sheets/Calendar, sync, offline, mensajería, billing | P2 | — | — | — |

---

## 6. Contradicciones, costos y bloqueos

**Aprobado por Tano/Juan (28/09):** Corte A 1/10 + Corte B 5/10; arquitectura y reutilización modular; repo nuevo en Daicou; Fran = admin con `can_approve_decisions` como capacidad independiente del rol; **IA fuera de P0** (P1); datos reales, lo ficticio marcado DEMO; ante recortes, salen kanban/timeline/export antes que la prueba E2E; piloto multivertical `Añelo — Discovery 2026` con 3 casos reales; Finding nunca → Opportunity automáticamente.

**Asumido sin objeción (avisar si no):** noticias/Executive AI/roadmap F0–F6 → P1; chat IA → P1; importador CSV → P1; 5 destinos; un solo dealflow; un catálogo de verificación; empresa + establecimiento + asset canónicos, target = relación con campaña.

**Costos mensuales estimados (piloto, 2 usuarios):** Supabase Free (0 USD) o Pro (25 USD, recomendado por backups); Vercel Hobby (0; Pro 20 USD si se necesitan crons frecuentes); Anthropic en P0: 0 si no se activa IA, y con extracción ~1–5 USD/mes a este volumen; Google Maps: 0 (solo URLs, sin API). Transcripción (P1): ~0,4 USD por hora de audio aprox. según proveedor — a confirmar.

**Bloqueos (quién los destraba):**
1. **Juan:** crear proyecto Supabase y Vercel, repo GitHub y dejar las variables de entorno **en `.env.local`, no en el chat**. Mientras tanto se avanza en local.
2. **Tano:** email real de Fran para la invitación; los 3 casos reales (tipo, dirección o zona, fuente/URL y fecha de cada dato, qué se sabe y qué no).
3. **Tano/Juan (no bloquea Corte A):** formato de salida del Morning Brief (¿Doc, Sheet, JSON?) para diseñar la ingesta P1.

---

## 7. Estimación P0

Supuesto: **8 h/día de implementación** (Juan + Claude). Hoy lunes 28/09 → jueves 1/10 ≈ **30 h**. Viernes 2/10 + fin de semana hasta el lunes 5/10 ≈ **+24 h** máximo; sin fin de semana ≈ **+8 h**.

| Bloque | Corte | v1 | v2 |
|---|---|---|---|
| Repo, Next+shadcn, Supabase CLI, CI, guards y runner de RUN72, deploy staging | A | 4 | 4 |
| Tenancy: workspaces, memberships + `can_approve_decisions`, invitación, login, RLS + tests de aislamiento | A | 6 | 6 |
| Esquema P0 + políticas + seed (Daicou, Discovery 2026, verticales, 3 casos reales) | A | 5 | 6 |
| Explorar: campaña/vertical, targets, fichas empresa/establecimiento/**asset**/contacto/fuente/claim | A | 8 | 10 |
| Agenda: jornadas, paradas, enlaces Maps, visita con notas | A | 4 | 4 |
| Findings (desde visita o fuente externa manual) + bandeja de revisión | B | 5 | 4 |
| Candidata → aprobación (decision) → dealflow en lista; ficha 360 | B | — | 3 |
| Decisión/comentarios de Fran + briefing interno con referencias | B | 4 | 4 |
| Inicio Tano/Fran, 5 destinos + móvil, estados vacíos y "no disponible" | B | 3 | 3 |
| Audit log (sin UI de timeline) | B | 2 | 1 |
| E2E Playwright de la prueba rectora, QA móvil, correcciones | B | 5 | 5 |
| Kanban, timeline UI, export CSV | — | incl. | **fuera** (backlog) |
| **Total** | | **46** | **50** |

Corte A = **30 h** (entra justo al 1/10). Corte B = **20 h** (requiere viernes + ~12 h del fin de semana; si no, el E2E se cierra el martes 6/10 o se recorta el briefing a una plantilla simple).

**Delta del cambio multivertical:** +6 h brutas (entidad `assets` y su ficha +3, candidata/aprobación +3, findings desacoplados de visita ≈ 0), −2 h al sacar kanban/timeline/export ya autorizados → **+4 h netas**. No cambia la arquitectura; sí cambia el modelo (una tabla nueva y dos máquinas de estado), por eso se consulta antes de arrancar.

No se escribe código hasta la aprobación de este delta.

---

## 8. Estado del Corte A (28/09, local)

| Pieza | Estado | Evidencia |
|---|---|---|
| Repo nuevo en Daicou (Next 16 + shadcn + Supabase CLI + zod + vitest) | **implementado** | `npm run build` OK, lint y typecheck limpios |
| Tenancy: workspaces, memberships, `can_approve_decisions` independiente del rol, invitaciones, perfiles, preferencias ≠ permisos | **probado** | `tests/db/isolation.test.ts` |
| RLS en todas las tablas + FK compuestas `(workspace_id, id)` | **probado** | usuario de B no lee/escribe/vincula datos de A (UI, API y DB) |
| Audit log append-only con autor y campos cambiados | **probado** | test + historial en la ficha |
| Esquema Corte A: campañas, verticales, fuentes, empresas, establecimientos, **activos**, contactos, afirmaciones, targets, jornadas, paradas, visitas | **probado** | `tests/db/data-rules.test.ts` (fuente obligatoria, precio con moneda/fecha/fuente, coordenadas solo verificadas, descarte con motivo) |
| Login por contraseña / enlace, alta solo por invitación, invitación → email → aceptación con rol y capacidad exactos | **probado en navegador (local, Mailpit)** | |
| Explorar: campañas multivertical, filtros vertical/estado, alta de objetivo (nuevo o existente), registros, verticales, fuentes | **probado en navegador** | |
| Ficha de empresa/establecimiento/activo: datos, fuente, campañas, afirmaciones, contactos, visitas, historial, edición | **probado en navegador** | |
| Agenda: jornadas, paradas en orden manual, Google Maps por parada y multi-parada (≤4, con avisos), visita con notas y consentimiento | **probado en navegador (escritorio y móvil 375px)** | `src/domain/maps.test.ts` |
| Rol de solo lectura sin controles de edición | **probado en navegador** | |
| Búsqueda global | **probado en navegador** | |
| Seed local: Daicou, `Añelo — Discovery 2026`, 8 verticales, sin casos inventados | **implementado** | `supabase/seed.sql` |
| CI (GitHub Actions con Supabase efímero) | **implementado, sin ejecutar** (no hay repo remoto) | `.github/workflows/ci.yml` |
| Staging en Vercel + Supabase cloud | **bloqueado** | faltan proyectos Supabase/Vercel y repo GitHub |
| Script de bootstrap del workspace en producción | **pendiente** | |
| 3 casos reales cargados | **bloqueado** | esperando datos de Tano |
| Inicios personalizados Tano/Fran, findings, revisión, candidatas, decisiones, briefing | **posterior (Corte B)** | la UI los muestra como "no disponible" |
