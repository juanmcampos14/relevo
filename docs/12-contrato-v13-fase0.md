# 12 · Contrato v13 — Fase 0: qué existe, qué falta, qué se reutiliza y cómo se verá

Fecha: 8 de octubre de 2026. Estado: **entregable de Fase 0 para aprobación. No se tocó producción, código de la app ni el CRM.**
Fuente de los datos: el CRM exportado hoy 8/10 a las 11:03 (152 empresas), la base de producción y el código.
Propuesta visual: https://claude.ai/artifact/4eePTsD8Eyp9NsCaGwJX9B (página "v13").

---

## 1. Confirmación de la dirección

Entendido y de acuerdo. RELEVO deja de ser un cerebro y pasa a ser la **interfaz ejecutiva de solo lectura** sobre el CRM y Drive:

- La inteligencia, las decisiones y la carga ocurren en ChatGPT y quedan en el CRM y en Drive.
- El **Context Engine** es determinístico: sincroniza, relaciona, guarda historial y aplica reglas explícitas. Sin IA para cambios ordinarios.
- RELEVO **no escribe en el CRM** y no crea, edita, borra ni reinterpreta datos de negocio.
- Tres espacios: Hoy, Misión y Brain. **Sin conversación ni campo "Decile algo a RELEVO"** en la primera versión.

Una consecuencia que conviene tener presente: hoy RELEVO tiene **correcciones humanas propias** que el Sheet no tiene. Ejemplo: Felici figura "Contactado · esperando respuesta (02/10)" en RELEVO y "Por contactar" en el Sheet. Hay además 9 "informaciones diferentes" pendientes.

Con el contrato v13 gana el Sheet. Propuesta:
- Esas correcciones quedan como **historial** en RELEVO.
- Te paso la lista para que las lleves al CRM si siguen valiendo.
- Después RELEVO muestra lo que dice el Sheet.

## 2. Inventario: qué existe y se reutiliza

| Pieza existente | Estado | En v13 |
|---|---|---|
| Lectura del Sheet con cuenta de servicio (solo lectura, Drive) | En producción | **Se reutiliza tal cual.** Es la base del Context Engine. |
| Detección por delta: huella por fila, solo procesa lo cambiado; si el Sheet no cambió no baja nada | En producción, probado con tu carga real (49 empresas y 16 contactos el 7/10) | **Se reutiliza.** Falta: borrados y huella por columnas usadas. |
| Registro de cada sincronización (cuándo, versión del Sheet, qué cambió, resultado, error) | En producción | **Se reutiliza** como estado de sincronización visible. |
| Historial por fila (cada versión vista, cuándo apareció, cuándo cambió) | En producción (lotes de importación + huellas) | **Se reutiliza.** Falta guardar el **valor anterior por campo** de forma consultable. |
| Identificadores externos (cada fila del Sheet ↔ su entidad en RELEVO) | En producción | **Se reutiliza.** Es la base del motor de relaciones. |
| Modelo de entidades: empresas, establecimientos, contactos y vínculos, tareas, fuentes, activos con historial de precios, señales, hallazgos, oportunidades con consumidor / decisor / pagador, paradas de visita | En producción (A y B) | **Se reutiliza.** OPORTUNIDADES, HALLAZGOS y RUTA calzan casi campo por campo con el modelo de A. |
| Misiones con miembros y roles (owner / puede trabajar / solo mira), reglas de acceso en la base, invitaciones | En producción | **Se reutiliza.** Para v13: todos "solo mira" salvo el owner. |
| Búsqueda | Existe, simple (por nombre en empresas, contactos, activos, hallazgos) | **Se reutiliza y amplía**: buscar en todo lo sincronizado, con filtros. |
| Superficie /hoy (Ahora · Explorar · Oportunidades · Misión) y panel /w | En producción | Se reemplaza por Hoy / Misión / Brain. Los componentes visuales sirven; la lógica que lee la síntesis de IA no. |
| Diff a tres puntas, "información diferente", campos bloqueados por corrección humana | En producción | **Se apaga para el CRM** (en v13 el Sheet manda). El código queda. |
| Juez de reconciliación con IA para el Radar (~USD 1/mes) | En producción | **Se suspende.** Contradice "sin IA para cambios ordinarios". El Radar se muestra como está en el Sheet; los duplicados se resuelven en el CRM. |

## 3. Procesos autónomos a suspender (reversible, sin borrar código)

Medido en producción del 3 al 7 de octubre: **~USD 98/mes de IA**.

| Proceso | Cuándo corre | USD/mes | Dependencias a cuidar |
|---|---|---|---|
| Morning Brief de RELEVO (investigación + armado + envío por mail) | 05:00 ART (cron) | 6,7 | Manda mails a Tano, Fran y Jenny: avisarles antes de cortar. |
| Vigilancia de la misión | 10:30 y 18:30 ART | 2,8 | Alimenta "Desde tu última visita" actual: se reemplaza por el delta del Sheet. |
| Síntesis diaria, estado de misión, objetivos por hipótesis, pulso, ingesta de candidatos del Brief, plan de AOG | 06:00 ART (cron "misión") + a pedido | 38,4 | Alimenta la superficie /hoy actual, que también se reemplaza. |
| Avanzar preparado | 06:40 ART + a pedido | 18,3 | Solo lo usa /hoy. |
| Estado de hallazgos (análisis a pedido) | Botón | 7,8 | — |
| Conversación con RELEVO (panel y /hoy) | A pedido | 22,6 | Suspender junto con el input. |
| Juez del Radar en la sincronización | En cada sync con Radar | 1,1 | Ver punto 2. |
| Procesamiento de capturas (fotos y notas con IA) | A pedido | 0,6 | Sin carga desde RELEVO en v13: se suspende. |

Cómo: quitar los cron de `vercel.json` y apagar cada proceso con una variable de entorno. El código y los datos quedan. Se hace en Fase 1, con tu OK, **en un solo deploy que no toca datos**.

**Resultado: USD 0 de IA recurrente.** v13 no necesita IA.

## 4. Mapeo de las diez pestañas (encabezados reales del 8/10)

Notación: ✔ ya se lee · ＋ hay que agregarlo · — no se usa (vacía o técnica). Entre paréntesis, las filas con valor.

### EMPRESAS — 152 filas · ID `AN-####` · **es el centro de las relaciones**
- ✔ ID, Empresa / establecimiento, Sector / actividad, Subsector, Localidad, Dirección, Teléfono, Sitio oficial, Prioridad, Etapa CRM, Propietario identificado (58), Última verificación, Estado de evidencia, Fuente ID, Responsable, Próxima acción (112), Fecha próxima acción (29), Notas.
- ＋ Vertical canónico (152), Rol misión (152), Estado ejecutivo (152), Evidencia ejecutiva (152), Tesis actual (152), Próxima decisión (152), Prioridad ejecución (152), Maps · enlace (23), Días sin verificar, Alerta.
- ＋ Inversión (46–58 c/u): Perfil inversión, Calidad aparente del negocio, Demanda recurrente / contractual, Problema / limitante, Apertura dueño / socio, Palanca de creación de valor, Señal financiera, Próximo paso inversión.
- — Carpeta expediente URL, Último email, Estado prospección, Última interacción (vacías hoy; se leen si se llenan).

### RED | CONTACTOS — 65 filas · ID `CT-###`
- ✔ ID, Nombre, Empresa ID (62, **todas válidas**), Cargo, Acceso / vínculo, Correo (27), Teléfono (23), LinkedIn (53), Fuente / referencia, Estado de relación, Responsable, Notas, No contactar.
- ＋ Próximo contacto, Estado correo, Fecha respuesta, Estado LinkedIn, Fuente contacto, Rol en originación, Gmail URL (5).

### ACTIVIDADES — 48 filas · ID `ACT-###` (pestaña oculta)
- ✔ ID, Empresa ID (44, todas válidas), Contacto ID (28), Tipo, Actividad / objetivo, Responsable, Vencimiento, Estado, Canal.
- ＋ Semáforo (VENCIDA 19 · PRÓXIMA 18 · PLANIFICADA 11), Resultado, Fecha ejecución, Documento / enlace (4), Oportunidad ID (vacía hoy).

### FUENTES — 101 filas · ID `SRC-…` (oculta)
- ✔ ID, Entidad vinculada (69 apuntan a empresas, el resto a contactos / radar / visitas), Tipo, Título, URL original (101), Fecha publicación, Fecha consulta, Calidad, Hecho que sustenta, Limitaciones.

### RADAR DE MERCADO — 66 filas · ID `RAD-…`
- ✔ ID, Fecha, Tema, Hallazgo, Implicación, Enlace, Fuente / validación, Tipo de señal, Activo / entidad, Categoría del activo, Ubicación, Precio actual / anterior, Capacidad / superficie, Ocupación, Broker, Operador, Economics, Primera detección, Última comprobación, Cambio material (Sí 26 · No 14 · Precio inconsistente 4 · Baja de precio 1), Capa de evidencia.
- ＋ Mostrar "Capa de evidencia" tal cual (Hecho publicado / Afirmación del vendedor / Mixto…): es la categoría de evidencia del contrato.

### OPORTUNIDADES — **0 filas** · 36 columnas
- ＋ Todas. Mapean 1:1 a la oportunidad del modelo A: Consumidor, Decisor, Pagador, Unidad económica, Capacidad nominal, Utilización actual, Demanda rechazada, Capacidad futura, Limitante, Palanca, Qué falta saber, Próxima validación, Etapa, Carril, Modelo RELEVO, Decisión, Riesgo, Intensidad de capital, Expediente.
- Mientras esté vacía, Misión muestra "El CRM todavía no tiene oportunidades registradas".

### HALLAZGOS — 2 filas · ID `HAL-###`
- ＋ Todas: Hallazgo, Tipo, Vertical, Empresa / lugar, Evidencia, Contraevidencia, Economía / impacto, Usuario afectado, Comprador / pagador, Fuente IDs, Qué falta saber, Próxima acción, Estado.

### RUTA | VISITAS — 54 filas · **sin ID propio** · encabezado en la fila 5
- ＋ Día, Orden, Franja, Zona, Vertical, Punto de visita, Dirección, Prioridad, Bloque, Objetivo de aprendizaje, Pregunta clave, Estado evidencia, Estado visita (En agenda 40 · Por coordinar 4 · A definir en campo 6 · otros 4), Hallazgo / conclusión (0), Próxima acción, ID CRM (7), Fuente, Acceso recomendado, Clase ejecución.

### INVESTIGACIÓN | ENTREVISTAS — 97 filas · **sin ID** · encabezado en la fila 5
- ＋ Industria, Dimensión, Pregunta, Qué evidencia pedir, Problema / hipótesis, Empresa entrevistada (0), Respuesta / dato (0), Fuente / fecha, Próxima acción.
- Hoy es un **banco de preguntas**, no de entrevistas hechas. Se muestra como guía por vertical; cuando haya respuestas, como evidencia.

### AOG | MAPA FÍSICO — 33 filas · **sin ID** · encabezado en la fila 5
- ＋ Prioridad, Actor, Stand, Zona física, CRM (25; 15 válidos), Rol misión, Día sugerido, Objetivo, Contacto / acceso (IDs de contactos), Estado.

**Representación visual de los campos codificados.** Estado ejecutivo (RESEARCH, QUALIFYING, CONTACTING, ARCHIVED) y Rol misión (TARGET, PARTNER, BUYER, ECOSYSTEM, ASSET / SOURCE…) se muestran con una **etiqueta en castellano fija y documentada, uno a uno**. Ejemplo: RESEARCH → "En investigación". Es una traducción visual, no una reinterpretación; la tabla de etiquetas se aprueba con vos.

## 5. El Context Engine sobre lo que ya existe

No es un motor nuevo: es **completar la sincronización de B y sacarle la IA**.

```
CRM (Sheet) ──cada 2–3 min: ¿cambió?──► Exportar (solo si cambió y quedó quieto 2 min)
                                              │
                         por pestaña: huella por fila (solo columnas mapeadas)
                                              │
              nuevas / modificadas / desaparecidas ──► aplicar tal cual (el Sheet manda)
                                              │
              historial por campo (antes → después, fecha de sync) + relaciones por ID
                                              │
                         reglas explícitas ──► Hoy · Misión · Brain · Fichas
```

Qué agrega cada capa:

1. **Sincronización incremental.** Ya existe. Se suma: las 5 pestañas que faltan, las columnas nuevas, borrados (punto 7) y la huella calculada solo con las columnas mapeadas. Así agregar una columna no reprocesa todo.
2. **Motor de relaciones.** Solo por identificador (Empresa ID, Contacto ID, Fuente IDs, ID CRM, Entidad vinculada). Nada por parecido de nombre. Ver punto 7.
3. **Historial.** Una tabla de cambios por campo: entidad, campo, valor anterior, valor nuevo, cuándo se sincronizó, y la fecha del hecho cuando el CRM la tiene (Fecha, Primera detección, Última verificación).
4. **Reglas de seguimiento.** Explícitas y versionadas en el código. Ejemplos:
   - "Actividad con Semáforo VENCIDA".
   - "Visita con estado Por coordinar a menos de 15 días".
   - "Radar con Cambio material = Precio inconsistente".
   - "Empresa con Prioridad Alta y sin Próxima acción".

   Cada regla dice por qué aparece algo.
5. **Estado técnico propio.** Última sincronización exitosa, errores, última visita de cada persona y permisos. Nunca datos de negocio.

## 6. Arquitectura de sincronización de solo lectura

- **Permiso:** la cuenta de servicio es **Lector** del Sheet (ya está así). No se pide escritura.
- **Frecuencia:** cada 2–3 minutos se consulta la fecha de modificación del Sheet (llamada de metadatos, gratis). Si cambió y no volvió a cambiar en ~2 minutos, se exporta y se procesa el delta. Lo que cargues desde ChatGPT aparece en **3–5 minutos**.
- **Por qué sondeo y no eventos:** los avisos de edición de Google Sheets no se disparan cuando escribe una integración como ChatGPT, y los avisos de Drive vencen y hay que renovarlos.
- **Quién dispara:** hoy son 16 cron diarios de Vercel. Para cada 2–3 minutos propongo **pg_cron en Supabase** llamando al endpoint de sincronización (sin costo extra). La alternativa es el plan Pro de Vercel.
- **Errores:**
  - Hasta 3 reintentos con espera.
  - Si falla, se registra el error y **no se toca nada de lo anterior**.
  - Hoy muestra "No pude sincronizar · lo anterior sigue intacto · último dato bueno: hace X".
  - Más de 30 minutos sin sincronizar = "desactualizado" en todas las pantallas.
- **Integridad:**
  - Una exportación con menos de la mitad de filas que la anterior en una pestaña, o sin la columna ID, se considera **lectura dudosa**: no se aplica y se avisa.
  - Esto protege contra borrar todo por un error de lectura.
- **Fechas:** se leen en hora de Argentina. Hoy algunas fechas del Sheet llegan como fecha-hora a las 21:00 del día anterior: hay que normalizarlas para no correr vencimientos un día.

## 7. Relaciones, borrados y duplicados

**Relaciones verificadas hoy en el CRM:**

| Relación | Con valor | Válidas | Qué pasa con el resto |
|---|---|---|---|
| Contacto → Empresa | 62 | 62 | — |
| Actividad → Empresa | 44 | 44 | — |
| Actividad → Contacto | 28 | (a verificar en Fase 1) | — |
| Fuente → Entidad | 101 | 69 empresas + resto contactos / radar | Se vincula a lo que el ID indique. |
| Ruta → Empresa (ID CRM) | 7 de 54 | 4 a empresas (todas válidas) + 3 a puntos del mapa | *Corregido en docs/13 §7.* La mayoría son recorridos, logística o bloques a definir: no necesitan empresa. |
| AOG → Empresa (CRM) | 15 de 23 actores | 15 | *Corregido en docs/13 §7:* la pestaña tiene dos tablas; 8 actores sin ID (3 empresas y 5 cámaras que no están en EMPRESAS). |

**Regla:** si no hay ID válido, **no se vincula**. Se muestra la fila y se marca "sin vínculo en el CRM". En Ruta y AOG muchas filas nombran empresas por texto ("VMFG / Vaca Muerta Housing / NEU") y no se van a adivinar. Para que aparezcan en las fichas, el CRM tiene que cargar el ID.

**Borrados:**
- Una fila que no aparece en una lectura **válida** se marca "desaparecida del CRM (fecha)".
- Se oculta de las vistas activas y sigue en el historial.
- Si vuelve a aparecer, se reactiva.
- No se marca nada en una lectura dudosa.

**Duplicados:**
- Se usan los IDs del CRM. No se fusiona por nombre.
- Cuando dos filas parecen la misma, se muestran las dos.
- La reconciliación se hace en el CRM, que ya tiene "ID anterior" para eso.

**Taxonomía, sin redefinir nada:**
- Las 10 verticales salen de "Vertical canónico" de EMPRESAS, tal como están.
- "Transversal / comprador / ecosistema" (14 empresas) **no es vertical** en el CRM. Se muestra aparte, como "compradores y ecosistema", con su nombre real.
- **Abastecimiento industrial no existe** como valor en el CRM actual. No se crea.
- Dos inconsistencias que solo se pueden corregir en el CRM:
  - HALLAZGOS usa "Activos / inmobiliario" en vez de "10 · Espacio comercial & inmobiliario".
  - RUTA | VISITAS tiene ~40 valores libres en "Vertical" ("Café + residentes", "Fitness / wellness"…).

  RELEVO los muestra tal cual y solo agrupa por vertical los que coinciden exactamente.

## 8. Propuesta visual

En el lienzo, página **"v13"** (la página "C1 · anterior" queda como referencia):

1. **Hoy:**
   - Encabezado con fecha, misión, objetivo, estado registrado y estado de sincronización.
   - Tres bloques: Cambió / Requiere de vos / Próximos movimientos. Sin input.
2. **Misión:**
   - Encabezado con objetivo, fechas, responsables, Mission Master y Field Plan.
   - Pestañas discretas: Resumen · Verticales · Oportunidades · Ruta y campo · AOG.
   - Las 10 verticales y "compradores y ecosistema" aparte.
3. **Brain:** búsqueda protagonista, filtros por tipo con cantidades reales y lista.
4. **Ficha de empresa:** Vaca Muerta Housing, con todo lo relacionado en una pantalla.
5. **Estados:**
   - Sin novedades.
   - Procesando.
   - Desactualizado.
   - Error.
   - Documento sin acceso.

**Todo el contenido es real del CRM de hoy.** Las fotos son espacios marcados: la fotografía de contexto tiene que venir de Drive (fotos de campo reales). No uso imágenes generadas ni de stock.

## 9. Permisos y múltiples misiones

- **Un Sheet por misión**, con el mismo contrato de datos (mismas pestañas y columnas mínimas; las verticales son las de cada misión). El Sheet se configura en la misión, no en el workspace como hoy.
- Lo de cada Sheet entra solo a su misión.
- Las reglas de acceso de la base ya filtran por misión. Se extienden a búsqueda, fichas, relaciones e historial. Si Fran no es de una misión, su buscador no devuelve nada de ella, ni siquiera "existe una empresa con ese nombre".
- Una empresa presente en dos misiones se muestra **dentro de cada misión** con los datos de esa misión.
- Roles en v13:
  - Owner: configura la misión, su Sheet e invita.
  - Miembros: solo consulta.
- **Drive:** RELEVO guarda el link, no el documento. Si el usuario no tiene permiso en Drive, Google lo bloquea y la ficha dice "Sin acceso al documento: pedíselo a su dueño".
  - Hoy, Mission Master, Field Plan y los Morning Briefs **no están compartidos con Juan**; desde acá solo veo el CRM, la carpeta "RELEVO | Vaca Muerta" y dos PPT de dirección.

## 10. Costos

| Concepto | Hoy | v13 |
|---|---|---|
| IA (medido 3–7 oct) | ~USD 98/mes | **USD 0 recurrente** |
| Sincronización | 16 corridas/día | ~300–500 chequeos/día (metadatos, gratis) + exportes solo cuando cambia (~200 KB) |
| Disparador de sincronización | Cron de Vercel | pg_cron de Supabase (sin costo extra) o Vercel Pro (USD 20/mes) |
| Base de datos | 42 MB | +~5–20 MB/año de historial con este volumen |
| Vercel y Supabase (plan) | **A confirmar** | Sin cambios |

Los planes no los puedo ver desde acá. Indicios: el proyecto Vercel `relevo` usa 16 cron diarios, lo que sugiere el plan gratuito. La organización de Supabase tiene otro proyecto pausado, típico del plan gratuito.

Hay que confirmarlos en Billing de Vercel y Supabase. Si Vercel es el plan gratuito, ojo: sus términos son para uso no comercial.

## 11. Plan por fases

**Fase 0 — este documento.** Aprobación de mapeo, etiquetas, reglas de Hoy y propuesta visual.

**Fase 1 — Datos confiables (~1,5–2 semanas):**
1. Suspender los procesos de IA (un deploy, reversible). Avisar a Fran y Jenny que el Brief de RELEVO se corta.
2. Pasar a "el Sheet manda". Entregarte las 9 diferencias y las correcciones humanas para que las lleves al CRM.
3. Huella por columnas mapeadas, lectura dudosa, borrados y fechas en hora de Argentina.
4. Columnas nuevas de EMPRESAS, CONTACTOS y ACTIVIDADES.
5. OPORTUNIDADES, HALLAZGOS, RUTA, ENTREVISTAS y AOG.
6. Historial por campo y relaciones por ID con reporte de vínculos rotos.
7. Sincronización cada 2–3 minutos con pg_cron.

**Criterio:** un informe automático que compara RELEVO contra el CRM (filas, campos y relaciones) da 100% de coincidencia.

**Fase 2 — Interfaz (~2 semanas):**
- Hoy, Misión, Brain, fichas, búsqueda, estados y responsive.
- Se borra la superficie anterior de la navegación.

**Criterio:** entender la misión lleva menos que navegar el Sheet. Prueba con Fran sin explicación previa.

**Fase 3 — Validación (2 semanas de uso en Añelo):** solo correcciones críticas.

## 12. Riesgos, dependencias y decisiones pendientes

**Riesgos:**
- **La calidad de RELEVO depende de los IDs del CRM.** Las visitas y actores de AOG sin ID no aparecen en las fichas hasta que se carguen (detalle en docs/13 §7).
- **Cambios de estructura del Sheet** (renombrar una columna o pestaña) cortan la lectura de esa columna. Se detecta y se avisa, pero hay que actualizar el mapeo. Conviene congelar los nombres de columnas mapeadas como contrato.
- **ChatGPT escribiendo a medias:** se mitiga esperando 2 minutos de Sheet quieto.
- **Correcciones hechas en RELEVO** que hoy no están en el Sheet se dejarían de mostrar (punto 1).

**Dependencias:**
- Acceso a Mission Master, Field Plan y a la fuente estructurada del Morning Brief.
- Plan de Vercel y Supabase.

**Decisiones que necesito:**
1. ¿Aprobás el mapeo (punto 4) y la tabla de etiquetas en castellano para los códigos?
2. ¿Aprobás las reglas de "Requiere de vos" y "Próximos movimientos" del lienzo?
3. Morning Brief externo: ¿en qué pestaña o archivo estructurado queda publicado (fecha, hasta 5 señales, qué afecta, fuentes, IDs del CRM)? Si es un Doc libre, solo se puede linkear.
4. Links de Mission Master y Field Plan (y compartirlos con quienes los vayan a abrir).
5. ¿OK a suspender los procesos de IA y el Brief de RELEVO en Fase 1, avisando a Fran y Jenny?
6. ¿OK a que las correcciones hechas en RELEVO pasen a historial y te las entregue para cargar en el CRM?
7. ¿pg_cron (sin costo) o Vercel Pro para la sincronización frecuente?
