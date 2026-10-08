# 13 · Insumos para cerrar el contrato de datos

Fecha: 8 de octubre de 2026. Fuente: CRM exportado hoy a las 08:03 (hora Argentina), base de producción y código.
**No se tocó producción, no se apagó ningún proceso y no se cambió el CRM.**

---

## 0. Correcciones a lo que informé antes

Al revisar fila por fila encontré tres errores míos:

- **AOG:**
  - Antes dije "25 con ID, 15 válidos, 10 IDs inexistentes". No es así.
  - La pestaña tiene **dos tablas**: actores (23 filas) y sesiones (9 filas). Las "10 inválidas" eran filas de la tabla de sesiones.
  - Real: de los 23 actores, **15 tienen ID y los 15 son válidos**; 8 no tienen ID (sección 7).
- **RUTA:**
  - Antes dije "7 con ID, 4 válidos". Real: 4 filas apuntan a empresas (9 IDs, **todos válidos**).
  - Las otras 3 apuntan a puntos del mapa (`MAP-024/029/030`, pestaña oculta MAPA | IMPORTAR), que también existen.
- **Lienzo v13, bloque "Cambió":**
  - Mezclaba cambios anteriores a la última visita.
  - Nombraba campos ("Tesis actual, Próxima decisión…") que hoy no se pueden verificar, porque todavía no hay historial por campo.
  - Ya está corregido en el lienzo. Lo mismo en la historia de la ficha.

## 1. Tabla de equivalencias (para tu revisión)

Criterio propuesto:
- Solo se traducen los **códigos en inglés**.
- Los valores en castellano, los números ("0 · SIN VALIDAR") y el texto libre **se muestran literalmente**.
- En la ficha, al lado de cada etiqueta, siempre se puede ver el valor original del CRM.

**EMPRESAS · Estado ejecutivo**

| Valor en el CRM | Filas | Etiqueta propuesta |
|---|---|---|
| RESEARCH | 144 | En investigación |
| QUALIFYING | 4 | En calificación |
| CONTACTING | 1 | En contacto |
| ARCHIVED | 3 | Archivada |

**EMPRESAS · Rol misión**

| Valor en el CRM | Filas | Etiqueta propuesta |
|---|---|---|
| ECOSYSTEM | 64 | Ecosistema |
| TARGET | 24 | Objetivo |
| ASSET / SOURCE | 23 | Activo / fuente |
| PARTNER | 18 | Socio potencial |
| SOURCE | 12 | Fuente |
| BUYER | 6 | Comprador |
| ARCHIVO | 3 | Archivo (ya en castellano) |
| BENCHMARK | 1 | Referencia |
| ORIGINATOR / SOURCE | 1 | Originador / fuente |

**AOG · Rol misión** es texto libre (23 combinaciones: BUYER / OPERATOR, MIDSTREAM / BUYER…). Propuesta: traducir cada palabra con la misma tabla (OPERATOR → Operador, MIDSTREAM → Midstream, ORIGINATOR → Originador, REAL ESTATE → Inmobiliario).

**Se muestran tal cual** (ya están en castellano o son códigos propios):
- *EMPRESAS:* Etapa CRM (Investigación 144 · Calificación 4 · Contactado 1 · Consolidado 3), Prioridad, Prioridad ejecución ("A · VIAJE 18–26 OCT", "B · ESTRATÉGICA", "C · RESEARCH", "D · RADAR"), Evidencia ejecutiva ("0 · SIN VALIDAR", "1 · FUENTE PÚBLICA", "2 · CONTRASTADA", "N/A"), Apertura dueño / socio.
- *RED | CONTACTOS:* Estado de relación (Por contactar 54 · Identificado 11), Estado correo, Estado LinkedIn.
- *ACTIVIDADES:* Tipo, Estado (las 48 en "Pendiente"), Semáforo (VENCIDA / PRÓXIMA / PLANIFICADA), Canal.
- *RADAR:* Tipo de señal, Cambio material (Sí / No / Precio inconsistente / Baja de precio), Capa de evidencia.
- *HALLAZGOS:* Estado y Estado evidencia.
- *RUTA:* Estado visita, Clase ejecución.
- *AOG:* Estado.

Dos observaciones:
- **"C · RESEARCH"** en Prioridad ejecución mezcla idiomas; RELEVO lo muestra literal salvo que decidan cambiarlo en el CRM.
- **Texto libre que se usa como estado**:
  - *EMPRESAS:* Estado de evidencia (29 valores), Perfil inversión (32), Demanda recurrente (32), Señal financiera (25), Calidad aparente (13).
  - *Otras pestañas:* Estado evidencia en RUTA (23) y Rol misión en AOG (23).

  RELEVO no puede filtrar ni contar por esas columnas sin interpretar. Se muestran como texto. Si quieren filtrarlas, conviene una lista cerrada en el CRM.

## 2. Reglas exactas de Hoy

Tres tipos de información, que **nunca se mezclan** y siempre dicen de dónde salen:

**A. Cambió — novedades en el CRM desde tu última visita**

| Cuenta como novedad | Cómo se muestra |
|---|---|
| Fila nueva en una pestaña leída | "Empresa nueva: [nombre] · [ID]" |
| Fila que desapareció del CRM (en una lectura válida) | "Ya no está en el CRM: [nombre] · [ID]" |
| Cambio de valor en un **campo de seguimiento**. Lista cerrada, a aprobar: Etapa CRM, Estado ejecutivo, Prioridad, Rol misión, Tesis actual, Próxima decisión, Próxima acción / fecha, Estado de relación, Estado (actividad), Precio actual USD, Cambio material, Estado visita, Etapa / Decisión de oportunidad | "[Campo]: antes → ahora" |

- **No cuenta como novedad:** columnas agregadas o renombradas, cambios de formato, reordenamiento de filas, ni cambios en campos fuera de la lista. Quedan en el historial técnico, no en Hoy.
- "Tu última visita" es la última vez que abriste RELEVO **en esa misión**.
- Cada novedad muestra la **hora de sincronización**, y la **fecha del hecho** solo si el CRM la tiene (Fecha, Primera detección, Última verificación).
- RELEVO no dice "sube", "baja", "mejora" ni "importa" salvo que el CRM lo diga. Ejemplo: "Baja de precio" solo si la columna Cambio material lo dice.

**B. Requiere de vos — lo que está pendiente según el CRM**

Son reglas sobre el estado actual del CRM, no sobre cambios.

| Regla | Columna y valor exacto |
|---|---|
| Actividades vencidas | ACTIVIDADES · Semáforo = "VENCIDA" (el semáforo del CRM; RELEVO no recalcula fechas) |
| Visitas sin cerrar | RUTA · Estado visita ∈ {Por coordinar, Gestionar acceso, Por reservar} |
| Precios inconsistentes | RADAR · Cambio material = "Precio inconsistente" |
| Hallazgos con contraevidencia | HALLAZGOS · Contraevidencia no vacía y Estado ∈ {Investigar, Contrastar} |
| Oportunidades con decisión pendiente | OPORTUNIDADES · Decisión = [valor a definir por ustedes] |
| Estado técnico | Sincronización con error, desactualizada o lectura dudosa |

**C. Próximos movimientos — lo que el CRM tiene agendado**

- ACTIVIDADES con Estado = "Pendiente" y Semáforo ∈ {PRÓXIMA, PLANIFICADA}.
- Ordenadas por Vencimiento y, dentro del mismo día, por la Prioridad de la empresa.
- Se muestra: actividad, empresa, responsable, canal y fecha. Nada más.

**Personalización (a decidir):** mostrar primero lo que tiene como Responsable a quien mira. Hoy casi todo dice "Tano": para Fran, Hoy se vería casi igual que para Tano.

**Trazabilidad de cada cifra del lienzo v13 (corregido):**

| Cifra | Origen exacto |
|---|---|
| 1 empresa nueva (ZLT, AN-0152) | Filas de EMPRESAS vistas por primera vez después de ayer 19:30 |
| 49 empresas modificadas | Filas de EMPRESAS cuya huella cambió en la sincronización de hoy 08:05. *Qué campos cambiaron no se puede saber hasta tener historial por campo.* |
| 1 contacto nuevo · 3 fuentes · 6 actividades | Mismo criterio en RED \| CONTACTOS (CT-065), FUENTES (SRC-137/138/139) y ACTIVIDADES |
| RAD-IND-01 nueva · RAD-ACT-19 y RAD-INF-01 modificadas | RADAR, mismo criterio |
| 19 actividades vencidas | ACTIVIDADES · Semáforo = VENCIDA |
| "3 son introducciones de Fran" | Texto de la actividad ("Pedir a Fran introducción…") en YPF, Tecpetrol y Vista, con vencimiento 5/10 |
| 7 visitas por coordinar o reservar | RUTA · Estado visita: Por coordinar 4 + Gestionar acceso 1 + Por reservar 2 |
| 4 precios inconsistentes | RADAR · Cambio material = Precio inconsistente |
| 2 hallazgos con contraevidencia | HALLAZGOS HAL-001 y HAL-002 |
| Próximos movimientos (VMFG, Añelo Storage, Milicic, Beraldi) | ACTIVIDADES con vencimiento 8 y 9/10, en orden |
| 18 próximas | ACTIVIDADES · Semáforo = PRÓXIMA |
| 152 / 48 / 65 / 2 / 0 / 54 / 40 (Misión) | Filas de EMPRESAS / Prioridad Alta / RED \| CONTACTOS / HALLAZGOS / OPORTUNIDADES / RUTA / Estado visita = En agenda |
| Empresas por vertical (43, 16, 6…) | EMPRESAS · Vertical canónico |
| "Ninguno contactado todavía" | RED \| CONTACTOS · Estado de relación: 54 Por contactar + 11 Identificado. **Ojo: RELEVO tiene registrados 7 contactos enviados que el CRM no refleja (sección 6).** |
| "Mes 01", "60 días · 12 oct–10 dic", objetivo | INICIO (fila 3) y CENTRO DE CONTROL (fila 3) |
| Hitos (18, 19, 20–21, 22–24, 26 oct) | RUTA \| VISITAS (Día) e INICIO |
| Gates 15 / 30 | CENTRO DE CONTROL · Calendario |
| "Hace 2 min", "hoy 08:05" | Registro de sincronizaciones de RELEVO |

## 3. Morning Brief por email: propuesta

**Recomendación: recibirlo por email en una dirección técnica, usando el proveedor de correo que ya tenemos (Resend).**
- Recibir está incluido en sus planes.
- Cada correo recibido llega a RELEVO como un aviso firmado (webhook).
- Resend guarda el correo aunque RELEVO esté caído.

Sin casilla tradicional, sin contraseña y sin servidor nuevo.

**Dirección:** dos opciones.
- **A (sin tocar DNS):** una dirección que da Resend en su propio dominio (`algo@<id>.resend.app`). Funciona en minutos.
- **B (más prolija):** `brief@in.relevo.site`. Requiere un registro MX en el subdominio `in.relevo.site`; no toca el envío actual, que sale de `mail.relevo.site`.

Recomiendo **B**, con una dirección por misión (`brief-anelo@in.relevo.site`), así cada Brief cae solo en su misión.

**Qué haría RELEVO con cada correo:**
1. **Verificar** la firma del aviso de Resend.
2. **Aceptar solo** correos cuyo remitente esté en una lista blanca (la dirección desde la que sale el Brief externo) y que pasen SPF / DKIM. Cualquier otro se guarda como rechazado y no se muestra.
3. **Guardar el original completo**, tal como llegó (asunto, remitente, fecha, Message-ID, HTML, texto y adjuntos), con su procedencia. Nada se reescribe.
4. **Edición:** la fecha del encabezado del correo, en hora de Argentina.
5. **Duplicados:**
   - El mismo Message-ID se ignora.
   - Si llegan dos correos distintos con la misma fecha de edición, se muestran como "edición del 8/10" y "reenvío del 8/10", sin fusionarlos.
6. **Mostrar:**
   - En Hoy, "Último Morning Brief · fecha · abrir".
   - Abre el correo tal como llegó (HTML sin imágenes remotas ni scripts), dentro de la misión.
   - Solo lo ven los miembros de esa misión.
7. **Edición faltante:** si a la hora habitual + 2 horas (decímela) no llegó la del día, Hoy dice "No llegó el Morning Brief de hoy". Un correo rechazado o ilegible dice "Llegó un correo que no pude leer".

**Sobre "máximo cinco señales, qué afecta, fuentes e IDs del CRM":** de un correo libre no se pueden sacar campos sin interpretarlo, y eso sería IA. Si el generador externo agrega al mismo correo un **adjunto `brief.json`** (o un bloque fijo al final) con esa estructura, RELEVO lo lee sin IA y vincula cada señal a su empresa por ID. Sin eso, el Brief se muestra completo y legible, pero sin vínculos. Si quieren, les paso el formato.

**Costo:** USD 0 adicional. Un correo por día por misión entra holgado en el plan; RELEVO guarda su propia copia (Resend borra a los 30 días).

**Lo que necesito:**
- El remitente exacto del Brief externo.
- La hora habitual de envío.
- Opción A o B. B requiere que quien maneja el DNS de `relevo.site` agregue un registro MX; yo paso el valor exacto.

**No afecta al envío externo:** RELEVO solo pasa a ser un destinatario más.

## 4. Mission Master y Field Plan

Verificado:

| | Mission Master | Field Plan |
|---|---|---|
| Archivo | `AÑELO_MISSIONMASTERFINAL.docx` | `AÑELO_FIELDPLAN.docx` |
| Tipo | **Word (.docx) subido a Drive**, no un Google Doc | Igual |
| Dueño | Tano | Tano |
| Acceso hoy | Tano (dueño), Juan, Fran y Jenny (edición) | Igual |
| Cuenta de servicio de RELEVO | **Sin acceso** | **Sin acceso** |

Qué necesita RELEVO:
- Para **mostrar el link**, nada: el link lo abre cada persona con su propia cuenta de Google, y Drive aplica sus permisos.
- Para mostrar el **título y la última modificación** (y avisar si cambió), la cuenta de servicio necesita **Lector** en esos dos archivos. No es necesario hacerlos públicos ni compartir la carpeta entera:
  - Compartir solo los dos archivos con `relevo-sheet-reader@relevo-510323.iam.gserviceaccount.com` como **Lector**, igual que el CRM.
  - RELEVO no lee el contenido ni lo resume.
- **"No tenés acceso" antes del clic:** saber de antemano si una persona puede abrir un documento requiere ver la lista de permisos del archivo. Hay que confirmar en Fase 1 si un Lector puede verla.
  - Si se puede, RELEVO avisa antes.
  - Si no, el aviso lo da Drive al abrirlo.

## 5. Inventario de procesos con IA: costo, dependencias y reversión

Costos medidos del 3 al 7/10, proyectados a 30 días. Horas en Argentina.

| # | Proceso | Disparador | USD/mes | Qué depende de él |
|---|---|---|---|---|
| 1 | Morning Brief de RELEVO (investigación web + armado + mail a Tano, Fran y Jenny) | Cron 05:00, reintentos 07:00 y 08:00 | 6,7 | Los mails del Brief de RELEVO. **No tiene relación con el Brief externo.** |
| 2 | Vigilancia de la misión (búsqueda web) + incorporación de candidatos | Cron 10:30 y 18:30 | 2,8 | Señales y "Desde tu última visita" de la superficie actual. Sigue corriendo: hoy sumó La Segunda y Avalian. |
| 3 | Síntesis diaria de la misión | Cron 06:00 + después de acciones en la conversación | 17,3 | Superficie /hoy actual |
| 4 | Estado de la misión | Cron 06:00 + al crear misión | 8,3 | Pantalla Misión actual |
| 5 | Objetivos por hipótesis | Cron 06:00 (cada 3 días) | 11,6 | Superficie /hoy actual |
| 6 | Pulso (re-priorizar por señales) | Cron 06:00 | 0 (se salta si nada cambió) | Foco de /hoy |
| 7 | Plan de AOG | Cron 06:00 | 1,2 | Ya cumplió |
| 8 | Avanzar preparado | Cron 06:40 + botón | 18,3 | Botón Avanzar de /hoy |
| 9 | Estado de hallazgos | Botón y al procesar capturas | 7,8 | Pantalla de hallazgos actual |
| 10 | Conversación con RELEVO (panel, /hoy, investigar) | Cada mensaje | 22,6 | Panel RELEVO AI y /hoy |
| 11 | "Desde tu última visita" interpretado | Al abrir /hoy | 0,4 | /hoy |
| 12 | Procesamiento de capturas (foto / nota) | Al subir una captura | 0,6 | Capturas |
| 13 | Juez del Radar en la sincronización del Sheet | En cada sync con filas nuevas del Radar | 1,1 | Importar el Radar (ver dependencia abajo) |
| | **Total** | | **~98** | |

Sin IA y **sin tocar** (siguen igual): sincronización del Sheet, mantenimiento (borra audios vencidos del experimento de voz), envío de invitaciones.

**Dependencias que cuidar:**
- **Radar (13).** Hoy la sincronización usa la IA para decidir si una fila del Radar es un hecho nuevo o uno ya conocido. Si se apaga la IA antes de tener la lectura determinística del Radar (Fase 1), las filas nuevas del Radar quedarían "sin juzgar". Propuesta: apagar 13 **en el mismo deploy** que la lectura nueva.
- **Brief de RELEVO (1).** Tano, Fran y Jenny dejan de recibirlo. Avisar antes. El externo no se ve afectado: RELEVO no comparte con él ni remitente, ni lista, ni proveedor de envío.
- **Superficie actual (/hoy y panel).** Sin 3–8 y 10 queda congelada en lo último calculado. Se reemplaza en Fase 2. Mientras tanto, sigue mostrando lo de antes con su fecha.

**Cómo se apaga (Fase 1, con tu OK):**
1. Un interruptor único: la variable `RELEVO_IA=apagada` en Vercel.
   - Todas las llamadas a IA (pasan por dos funciones: `deepCall` y el agente de conversación) se registran como "omitida" y no llaman al modelo.
   - Los botones que dependen de IA dicen "pausado".
2. Sacar de `vercel.json` los cron de brief, misión, avanzar y vigilancia (7 entradas). Quedan sheet y mantenimiento.
3. Un solo deploy. No se borra código ni datos.

**Cómo se revierte:**
- Borrar la variable `RELEVO_IA` y revertir el commit de los cron (`git revert`).
- Un deploy y todo vuelve a correr a la hora siguiente.

**Cómo se verifica:** cero filas nuevas con costo en el registro de IA durante 48 horas.

## 6. Diferencias entre RELEVO y el CRM (completas)

### 6.1 Las 9 "informaciones diferentes" pendientes

"Valor CRM" es lo que dice hoy el CRM; "Valor RELEVO" es lo que conserva RELEVO.

| # | Entidad (ID CRM) | Campo | Valor RELEVO | Valor CRM hoy | Origen del valor de RELEVO | Detectado |
|---|---|---|---|---|---|---|
| 1 | Activo · Espacio Añelo (RAD-HOU-02) | Título | "Espacio Añelo · 1.040 m²" | Hallazgo: "Espacio Añelo declara 1.040 m², 100% construido/alquilado, renta anual proyectada 10,88%…" | Regla de RELEVO (1/10): el título de un activo lo identifica y no copia la frase del vendedor. **No es un dato de negocio.** | 6/10 |
| 2 | Activo · BIT Añelo (RAD-HOU-03) | Título | "BIT Añelo · proyecto de 6 edificios" | "BIT Añelo proyecta 6 edificios × 4 pisos × 4 deptos/piso × 4 camas/depto = 384 camas potenciales." | Igual que 1 | 6/10 |
| 3 | Activo · Edificio Molle (RAD-HOU-04) | Título | "Edificio Molle · proyecto hotelero de 90 habitaciones" | "Edificio Molle se ofrece como proyecto hotelero llave en mano de 90 habitaciones, 3.335 m²…" | Igual que 1 | 6/10 |
| 4 | Activo · Dos naves · Parque Industrial (RAD-ACT-02) | Última comprobación | 2026-10-02 | 2026-09-30 | Morning Brief de RELEVO del 2/10 (Argenprop, USD 1.200.000) | 6/10 |
| 5 | Activo · Departamento La Meseta (RAD-ACT-03) | Superficie / cambio material | "Corregido el 01/10 (Tano): USD 115.000 actual, USD 127.000 anterior; 38 m², 2 dormitorios, 4 camas. La fila del Sheet traía datos de RAD-ACT-04." | Capacidad / superficie: "450 m² cubiertos · 900 m² terreno · 7 unidades · 26 plazas"; Cambio material: "Precio inconsistente" | **Corrección de Tano del 1/10**, cargada en RELEVO. La superficie del CRM coincide con la de RAD-ACT-04 (posible copia de fila). | 6/10 |
| 6 | Activo · Complejo 7 departamentos (RAD-ACT-04) | Cambio material | "Corregido el 01/10 (Tano): USD 750.000 (Leo Sfeir) y USD 810.000 (ficha equivalente) = PRECIO INCONSISTENTE" | Cambio material: "No"; Precio anterior: vacío | **Corrección de Tano del 1/10** | 6/10 |
| 7 | Empresa · Vaca Muerta Facility Group (AN-0035) | Estado de evidencia | "Verificado públicamente" | "Sitio oficial verificado" | Importación del CRM del 1/10 (el valor que tenía el CRM entonces). **No es corrección humana**: es una diferencia de redacción. | 7/10 |
| 8 | Empresa · Vaca Muerta Facility Group (AN-0035) | Notas | "También figura en el CRM como AN-0096 (unificada con AN-0035)…" | "Canónico; consolidado con AN-0096. Sitio invita socios estratégicos." | Nota que escribió RELEVO al unificar AN-0096 con AN-0035 (aprobado el 1/10). **No es dato de negocio.** | 7/10 |
| 9 | Empresa · El Pampita Truck Center (AN-0025) | Próxima acción | "Reunión del 7/10 15:00 cancelada. Proponer a Martín miércoles 21 o jueves 22/10 en Añelo." | "Cita del 07/10 ya vencida según Morning Brief 08/10. Confirmar si hubo reunión con El Pampita y registrar resultado…" (fecha 08/10) | **Tano, por la conversación de RELEVO, el 6/10 08:49**: "cancelar la reunión de mañana; se reprograma durante la misión". **El CRM no sabe que la reunión se canceló.** | 8/10 |

Lectura rápida:
- **Con contenido de negocio que el CRM no tiene: 5, 6 y 9.** Son las que importa revisar.
- **Desaparecen solas en v13: 1–3, 7 y 8.**
  - Para 1–3, RELEVO usa "Activo / entidad" del Radar como título, que ya existe.
  - 7 y 8 se muestran tal como las dice el CRM.
- **4** es una fecha de comprobación que vino del Brief de RELEVO. Si el CRM no la quiere, se descarta.

### 6.2 Ya decidida (pero con información que el CRM no tiene)

| Entidad | Campo | RELEVO | CRM | Origen | Decisión |
|---|---|---|---|---|---|
| Juan Pablo Felici (CT-029) · Pluspetrol | Estado de relación | "Contactado · esperando respuesta (02/10)" | "Por contactar" | Tano, por la conversación de RELEVO, el 2/10 09:42 ("Contacto enviado… seguimiento el 7/10") | "Mantener lo actual", en la prueba del Bloque B (6/10) |

### 6.3 Hechos registrados solo en RELEVO

En v13 dejarían de verse. Los registró Tano conversando con RELEVO.

| Fecha | Hecho |
|---|---|
| 1/10 | Contacto enviado a Enrique García (CACIPAA / Sol y Luna) por WhatsApp |
| 2/10 | Contacto enviado a Juan Pablo Felici (Pluspetrol) |
| 2/10 | **Nicolás Raviola ya no está en PECOM** (queda como relación anterior). **El CRM y AOG todavía lo listan como contacto de PECOM (CT-030).** |
| 2/10 | Tarea: conseguir el número de Juan Migliore (dueño de tierras con petróleo, según Tano) |
| 2/10 | Contacto enviado a El Pampita Truck Center; reunión 7/10 15:00 con Martín (dueño) |
| 6/10 | Contacto enviado a Martín (El Pampita); reunión cancelada, a reprogramar en la misión |
| 6/10 | Contactos enviados por LinkedIn a Alejandro Marcus (Urban View), Juan Manuel Brofman Aguilar (Petro Añelo) y José Luis Adissi (Crear Inmobiliaria) |
| 1–2/10 | 6 evidencias web registradas (bypass y control en RP7, CACIPAA, farmacias…) |
| 2/10 | Pedido: avisar cuando aparezcan locales que cumplan los parámetros de Tano |

**Entidades que la IA de RELEVO sumó y no están en el CRM:** GyP, XRG, Café Martínez, Aluvional, CEPH, Waldemar Dimaschow, INCRO y, hoy, La Segunda y Avalian. Propuesta para v13: no se muestran, porque no están en el CRM. Les paso la lista para que decidan si las cargan.

### 6.4 Filas del CRM que RELEVO retuvo "para revisar" y no aplicó

Además de las diferencias, la sincronización retuvo 7 filas. Hoy RELEVO **no muestra lo que dice el CRM** en ellas:

| ID | Empresa | Por qué se retuvo |
|---|---|---|
| AN-0096 | Vaca Muerta Facility Group · DUPLICADO CONSOLIDADO | El CRM la marcó duplicada de AN-0035 (renombrándola); RELEVO lo vio como un cambio de nombre a revisar |
| AN-0121 | FERRELEC / Genelec · DUPLICADO CONSOLIDADO | Igual, duplicada de AN-0024 |
| AN-0024 | FERRELEC / Genelec | El CRM vació campos (actividad, próxima acción, fecha, notas); RELEVO nunca vacía un dato solo |
| AN-0112 / AN-0021 | Lavadero Industrial Rotación SRL | Posible duplicado entre las dos filas |
| AN-0035 | Vaca Muerta Facility Group | Conflicto en actividad y próxima acción (punto 6.1, #7 y #8) |
| AN-0025 | El Pampita Truck Center | Conflicto en la fecha de próxima acción (6.1, #9) |

**Sugerencia para el contrato de datos:** el CRM marca duplicados de dos maneras ("Etapa CRM = Consolidado" y el sufijo "· DUPLICADO CONSOLIDADO" en el nombre). Una columna explícita **"Consolidado en"** (con el ID canónico) le permitiría a RELEVO ocultar el duplicado y redirigir a la empresa correcta sin interpretar texto.

En v13 (el Sheet manda), estas filas se aplicarían tal como están en el CRM.

## 7. RUTA | VISITAS y AOG: relaciones, fila por fila

Clasificación propuesta para que la confirmen. **No se inventa ningún vínculo**: solo digo qué tipo de fila es.

### RUTA | VISITAS (54 filas, sin ID propio)

| Grupo | Filas | ¿Necesita Empresa ID? |
|---|---|---|
| **A. Ya vinculadas a empresas** (IDs válidos) | 14 (YPF, Pan American Energy, Vista) · 15 (Nueva Vision T&S) · 32 (Vaca Muerta Facility Group, Vaca Muerta Housing, Grupo NEU) · 33 (Gestoría Inmobiliaria Añelo, Leo Sfeir & Asoc.) | Ya lo tienen |
| **B. Vinculadas a un punto del mapa** (MAP-…) | 22 (Cruce RP7/RP17, MAP-030) · 25 (Parque Industrial, MAP-029) | No: son lugares |
| **C. Organización con nombre que no está en EMPRESAS** | 16 FECENE + ADENEU · 18 Galicia · Nación · Supervielle · Comafi (panel) · 29 CEISA / Cámara (tiene MAP-024) | **Sí, si quieren verlas en fichas**: hay que darlas de alta en EMPRESAS (o en una lista de instituciones) |
| **D. Recorridos y lugares de observación** | 2–9, 11, 21, 23, 24, 26, 27, 37–41, 45–49 (24 filas: The Coffee Store, Alto Comahue Shopping, Paseo de la Costa, barridos urbanos, cambios de turno…) | No |
| **E. Bloques a definir en campo** | 30 Caso #1 · 31 Caso #2 · 34 Operador subescalado · 35 Buyer check · 42 Follow-ups | Cuando se defina la empresa |
| **F. Logística, síntesis y traslados** | 1, 10, 12, 20, 28, 36, 43, 44, 50–54 (13 filas) | No |
| **G. Sesiones de AOG** | 13 Taller de Proveedores · 17 Panel energía · 19 Segundas conversaciones | No (son eventos) |

### AOG | MAPA FÍSICO

**Tabla de actores (23):**
- **Con ID válido (15):** YPF, Tecpetrol, Pluspetrol, Pan American Energy, PECOM, Milicic, PROSEIND, Nueva Vision T&S, Mobilbox, Box Rental, Comercial Argentina, SAMPE, Salud Empresaria SEM, AESA y ZLT.
  - Todos los contactos citados (CT-023 a CT-061) existen.
  - CT-030 (Raviola, PECOM) ya no estaría en la empresa (6.3).
- **Sin ID (8):**
  - **Empresas que requieren ID:** Chevron, Oldelval y CAPEX. Están como compradores u operadores y no figuran en EMPRESAS.
  - **Cámaras / originadores:** Centro PyME · ADENEU, CAPESPE, CASEPE, CEIPA y CEOPE. Hay que decidir si van a EMPRESAS o a una lista de instituciones. Ninguno está hoy en el CRM.

**Tabla de sesiones (9):** Comisión Compliance; TotalEnergies · PAE · Vista · Quintana; YPF; COMAT; FECENE + ADENEU; Comisión Planeamiento; Bancos; Segundo día; Gino Zavanella · ZLT.
- Son eventos y no necesitan Empresa ID.
- Si quieren que una sesión aparezca en la ficha de YPF o ZLT, hace falta una columna con los IDs.
- Recomendación de contrato: **separar las sesiones en otra pestaña o bloque con encabezado propio**. Dos tablas en una misma pestaña son frágiles de leer.

## 8. Sincronización con Supabase: qué verificar antes de aprobar

**Mecanismo:**
- `pg_cron` (programador dentro de la base) + `pg_net` (llamada HTTP saliente) llaman cada 2 o 3 minutos al endpoint de sincronización que ya existe, con su clave.
- Ambas extensiones están disponibles en todos los planes de Supabase.
- El trabajo pesado sigue en Vercel, como hoy.

**Carga estimada:**
- 480–720 llamadas por día.
- La gran mayoría solo pregunta a Google "¿cambió?" y termina en menos de un segundo.
- Exporta y procesa solo cuando el Sheet cambió y quedó quieto 2 minutos.

**Observabilidad:**
- Cada corrida queda en el registro de sincronizaciones: hora, resultado, filas, error y duración.
- Se suma un aviso si pasan más de 30 minutos sin una sincronización buena: se ve en todas las pantallas y opcionalmente por mail al owner.
- El historial de `pg_cron` queda en la base.

**A verificar en los paneles (desde acá no se ven):**

| | Qué mirar | Por qué |
|---|---|---|
| Supabase | Plan de la organización "JC 2" (proyecto RELEVO) | Si es gratuito: 500 MB de base (hoy 42 MB), límites de tráfico y pausa por inactividad (con el cron no debería pausar) |
| Vercel | Plan del equipo del proyecto `relevo` | Si es Hobby: cuota de invocaciones (720/día entran holgadas), duración máxima de funciones y **términos de uso no comercial** |
| Google Cloud | Proyecto `relevo-510323` | Cuota de Drive API: 720 consultas/día está muy por debajo del límite gratuito |
| Resend | Plan actual | Envío y recepción (sección 3) |

## 9. Qué falta para cerrar el contrato de datos

**De ustedes:**
1. Revisión de la tabla de equivalencias (1) y de la lista de campos de seguimiento (2-A).
2. El valor de OPORTUNIDADES · Decisión que significa "pendiente".
3. Remitente y hora del Brief externo, y si van por la opción A o B (3).
4. Compartir Mission Master y Field Plan como Lector con la cuenta de servicio, si quieren título y fecha de modificación (4).
5. Decisión sobre las diferencias 5, 6 y 9, sobre Raviola / PECOM y sobre los contactos enviados que el CRM no refleja (6).
6. Clasificación final de RUTA y AOG, y si las cámaras van a EMPRESAS (7).
7. Columna "Consolidado en" y separar las sesiones de AOG (recomendaciones, no requisitos).
8. Planes de Supabase, Vercel y Resend (8).

**De mi lado,** con eso cierro el contrato y paso el plan de Fase 1 para aprobación.
