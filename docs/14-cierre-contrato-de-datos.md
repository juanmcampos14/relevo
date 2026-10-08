# 14 · Cierre del contrato de datos

Fecha: 8 de octubre de 2026. Decisiones de Tano del 8/10 sobre docs/13.

## 1. Qué quedó implementado (en producción, versión 9587dfb)

- **ACTIVIDADES:**
  - Se leen las columnas R (Bloque operativo · RELEVO) y S (Prioridad preparación) tal cual.
  - Las fechas escritas por automatizaciones ("Mon Oct 05 2026 21:00:00 GMT-0300") ya no se pierden. Se toman como la fecha UTC que representan: 21:00 de Argentina = día siguiente.
- **RUTA | VISITAS y AOG | MAPA FÍSICO** entran como agenda de campo de la misión, con la clasificación aprobada:
  - empresa, solo con ID válido de EMPRESAS;
  - ubicación (MAP-…), u organización si el mapa la marca institucional;
  - organización (cámaras);
  - sesión (AOG, como evento);
  - recorrido, a definir, logística;
  - empresa sin ID (Chevron, Oldelval, CAPEX: candidatas, no se crean).

  Nada se vincula por parecido de nombre. Se procesa solo lo que cambió y el estado literal del CRM se conserva.
- **Actividad "cancelada":** una actividad puede quedar cancelada (ni hecha ni pendiente) y conserva su historial.
- **Cola de candidatos al CRM:** lo que RELEVO conoce y el CRM no. Guarda procedencia, evidencia y posible duplicado, y no se incorpora sola.
- **Mission Master y Field Plan:** RELEVO refresca título y última modificación en cada sincronización, sin leer el contenido. Requiere que estén compartidos como Lector con la cuenta de servicio.
- Tests: 4 de dominio y 1 de base sobre la sincronización real. Suite completa en verde (331).

## 2. Campos de seguimiento ("Cambió") y qué se puede detectar

Criterio aprobado: solo cambios que alteran **decisiones, estado comercial, responsable, vencimiento, evidencia, próxima acción o resultado**.

| Pestaña | Columna del CRM | Categoría | ¿Se detecta "antes → ahora" hoy? |
|---|---|---|---|
| EMPRESAS | Etapa CRM | Estado comercial | Sí |
| EMPRESAS | Estado ejecutivo | Estado comercial | Sí, desde el 7/10 21:05 (historial completo de la fila) |
| EMPRESAS | Prioridad | Decisión | Sí |
| EMPRESAS | Próxima decisión | Decisión | Sí, desde el 7/10 21:05 |
| EMPRESAS | Tesis actual | Decisión | Sí, desde el 7/10 21:05 |
| EMPRESAS | Responsable | Responsable | Sí |
| EMPRESAS | Próxima acción · Fecha próxima acción | Próxima acción / vencimiento | Sí |
| EMPRESAS | Estado de evidencia · Evidencia ejecutiva · Última verificación | Evidencia | Sí (Evidencia ejecutiva desde el 7/10) |
| RED \| CONTACTOS | Estado de relación · Responsable · Próximo contacto | Estado comercial / responsable / vencimiento | Sí |
| ACTIVIDADES | Estado · Resultado · Fecha ejecución | Resultado | Sí |
| ACTIVIDADES | Vencimiento · Responsable · Prioridad preparación | Vencimiento / responsable / decisión | Sí (prioridad desde que se lean las columnas R y S) |
| RADAR | Precio actual USD · Cambio material · Capa de evidencia | Evidencia | Parcial: el precio queda en el historial del activo; las otras dos columnas solo tienen su último valor |
| HALLAZGOS | Estado · Estado evidencia · Contraevidencia | Evidencia / decisión | No: la pestaña todavía no se lee |
| OPORTUNIDADES | Etapa · Decisión (vacía = Pendiente solo al mostrar) | Decisión | No: la pestaña está vacía y todavía no se lee |
| RUTA \| VISITAS | Estado visita · Hallazgo / conclusión · Próxima acción | Resultado / próxima acción | Desde hoy, el valor actual. **El "antes" no se guarda todavía:** se ve qué fila cambió, no el valor anterior. |
| AOG | Estado | Estado comercial | Igual que RUTA |

**Cómo se detecta:**
- Cada sincronización guarda la fila completa del CRM tal como llegó.
- Comparando dos versiones de la misma fila se obtiene "antes → ahora" en cualquier columna.
- Eso existe para EMPRESAS, CONTACTOS, ACTIVIDADES y FUENTES desde el 6/10 (con todas las columnas desde el 7/10 21:05).
- Hacia atrás de esas fechas no hay historial.

**No cuentan como cambio:** columnas nuevas o renombradas, formato, orden de filas, y cualquier columna fuera de esta lista.

## 3. Procesos de IA: esenciales, solapados con el Brief externo y suspendibles

Sin apagar nada (decisión del 8/10). Costos medidos 3–7/10, a confirmar con los consumos reales.

| Proceso | USD/mes | Clasificación | Por qué |
|---|---|---|---|
| Juez del Radar en la sincronización | 1,1 | **Esencial hoy** | Sin él, las filas nuevas del Radar quedan sin procesar. Se reemplaza solo junto con una lectura determinística del Radar. |
| Conversación con RELEVO | 22,6 | **Esencial hoy** | Es el canal por el que registrás correcciones (cancelaciones, contactos enviados, cambios de empresa). Se puede abaratar sin perderla. |
| Procesamiento de capturas (foto / nota de campo) | 0,6 | **Esencial en el viaje** | Es como Fran y vos van a cargar desde el campo. |
| Morning Brief de RELEVO | 6,7 | **Solapado** con el Brief externo | Hace lo mismo y además manda mails. |
| Vigilancia 2 veces por día + incorporación de candidatos | 2,8 | **Solapado** | Investiga afuera, como tu circuito, y suma entidades que no están en el CRM (así nacieron las 9 de la cola). |
| Síntesis, estado de misión, objetivos, pulso, plan AOG | 38,4 | **Suspendible** cuando Hoy lea el CRM | Produce la tesis y el foco que hoy están en el CRM (Tesis actual, Próxima decisión, P1/P2). Si se apaga antes, la pantalla actual queda congelada. |
| Avanzar preparado | 18,3 | **Suspendible** | Prepara mensajes y pasos que hoy armás en ChatGPT. |
| Estado de hallazgos | 7,8 | **Suspendible** | Los hallazgos se evalúan en el CRM. |
| "Desde tu última visita" interpretado | 0,4 | **Suspendible** | Lo reemplaza "Cambió", que es determinístico. |

**Reversión** (sin cambios desde docs/13 §5): un interruptor por variable de entorno, más quitar los cron. Se revierte sacando la variable y revirtiendo el commit. Dependencia: el juez del Radar se apaga en el mismo deploy que su reemplazo.

## 4. Correcciones humanas para incorporar al CRM

Están en [propuestas-crm-2026-10-08.csv](propuestas-crm-2026-10-08.csv): 11 filas con pestaña, ID, valor actual en el CRM, valor propuesto, origen, fecha y evidencia. RELEVO no escribe en el CRM: el archivo es para que lo revisen y lo carguen ustedes.

## 5. Prueba final (8/10, producción)

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| 1 | RELEVO lee las actividades P1 del CRM | **PASS** | 10 de 10 P1 y 38 P2, iguales al CRM (prioridad, bloque, título). Ninguna actividad quedó sin vencimiento: antes se perdían las fechas escritas como texto. |
| 2 | Presenta empresa, contacto, evidencia y próximo paso correctos | **PASS (datos)** | Las 10 P1 tienen la empresa y el contacto del CRM (ACT-031 no tiene empresa en el CRM, solo contacto, y así quedó). Evidencias por empresa: de 0 a 5. Próximo paso: la propia actividad, y la "Próxima acción" de la empresa cuando el CRM la tiene. **La pantalla nueva (v13) no está construida**: hoy se ve en las pantallas actuales. |
| 3 | Conserva tus correcciones y la cancelación de El Pampita | **FAIL: bloqueado** | Las correcciones están preparadas y no se aplicaron: el control de permisos de mi entorno frenó el script que escribe en producción. Hoy las correcciones de La Meseta y del complejo de 7 departamentos están protegidas (no las pisa el CRM). La cancelación de El Pampita **todavía no está registrada**. |
| 4 | No confunde cámaras, sesiones, ubicaciones y empresas | **PASS** | 91 paradas: 24 empresa (todas con ID válido y vínculo), 6 organización, 14 sesión, 2 ubicación, 23 recorrido, 6 a definir, 13 logística, 3 empresa sin ID. Cero inconsistencias. No se creó ninguna empresa (Chevron, CAPESPE, CEISA). |
| 5 | Un resultado de prueba se registra, se sincroniza y se revierte sin pérdida | **PASS** | En el CRM, RUTA O37 (23/10 "Operador de housing/facility", Hallazgo / conclusión): se escribió a las 15:19, entró a las 15:20 en sus 3 paradas, se borró a las 15:23 y salió a las 15:24. Mismas paradas (mismo registro), sin duplicados. |
| 6 | Fran accede a la misión correcta con sus permisos | **FAIL: bloqueado** | El permiso está bien: es miembro solo de Añelo y no ve Mountain Suites ni LAO. Pero **Fran nunca confirmó su cuenta ni entró**. Jenny entró el 6/10. |

**Problemas encontrados y corregidos durante la prueba (en producción):**
- **IDs repetidos en el CRM.** ACT-049, ACT-050 y ACT-051 están dos veces en ACTIVIDADES y frenaban la sincronización entera (15:05, error). Ahora esas filas no se procesan, se informan y el resto sigue. **Hay que corregirlas en el CRM.**
- **Reestructuración de RUTA en vivo.** Orden pasó a códigos (NQN-1, AOG-1, SAB-1…). RELEVO usa ese código como identidad de la visita. Las paradas de filas que ya no están salen de la agenda, solo con una lectura válida. Sin duplicados.

**Diferencia con la clasificación aprobada (para que decidas):** "FECENE + ADENEU" (20/10) y el panel de bancos (21/10) están dentro del bloque AOG del CRM. La regla los clasifica como **sesión**; en la tabla aprobada figuraban como organizaciones. Si las querés como organización, lo más limpio es que el CRM lo diga en una columna.

## 6. Pendiente real para usar RELEVO

**Bloqueantes:**
1. **Permiso para aplicar las correcciones aprobadas** (`scripts/.contrato.tmp.mjs`, guarda el estado anterior de todo para revertir). Aplica:
   - las decisiones sobre las 9 diferencias;
   - la cancelación de El Pampita (reunión y parada canceladas, tarea "sacar de la agenda" hecha);
   - la marca de Raviola como dato desactualizado del CRM;
   - el estado "contactado" de los 4 contactos sin reflejar;
   - la cola de candidatos (9 de la IA, Enrique García y Chevron / Oldelval / CAPEX);
   - las consolidaciones (AN-0096 → AN-0035, AN-0121 → AN-0024, AN-0021 → AN-0112);
   - el alta de Mission Master y Field Plan en la configuración.
2. **Fran tiene que entrar.** Hay que reenviarle la invitación (requiere tu OK, porque sale un mail).
3. **Mission Master y Field Plan:** Juan no puede compartirlos (Drive no le da permiso); los tiene que compartir Tano como Lector con `relevo-sheet-reader@relevo-510323.iam.gserviceaccount.com`.
4. **IDs repetidos ACT-049/050/051** en el CRM.

**No bloqueantes (siguiente etapa):**
- Pantallas v13 (Hoy / Misión / Brain) leyendo esto.
- HALLAZGOS y OPORTUNIDADES.
- Recepción del Morning Brief (falta el remitente real y verificar la recepción en nuestra cuenta de Resend).
- Decidir qué procesos de IA se suspenden.
- Planes reales de Supabase, Vercel y Resend.
