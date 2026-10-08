# 15 · Primer caso real: Vaca Muerta Village (OP-001)

Fecha: 8 de octubre de 2026, en producción (versión 3ec6f7d).

## Recorrido y estado

| Paso | Dónde vive (CRM) | Qué hace RELEVO | Estado con OP-001 |
|---|---|---|---|
| 1. Contacto entrante | RED \| CONTACTOS (con Empresa ID) | Lo lee y lo vincula a la empresa | **Falta en el CRM.** OP-001 dice "Origen: contacto entrante + audio y PDF", pero no hay ninguna persona cargada para AN-0153, ni link al PDF o audio ("Expediente / enlace" vacío). |
| 2. Empresa | EMPRESAS | La lee, con notas e investigación | **OK.** AN-0153 entró hoy. Antes la frenaba su etapa nueva, "Descubrimiento"; ya corregido. |
| 3. Oportunidad | OPORTUNIDADES | La lee completa: las 36 columnas tal cual, vinculada a su empresa | **OK.** OP-001 en RELEVO con empresa, tesis, riesgos, confianza, economía, qué falta, próximo hito y decisión. |
| 4. Investigación | Notas de EMPRESAS, FUENTES (Entidad vinculada), "Evidencia principal" | La cita con su origen y separa hecho de declaración | **OK, con un límite:** la investigación sobre CB Developers y Piedrabuena está en las Notas de AN-0153 (con links), no en FUENTES. RELEVO la usa igual, pero no la puede contar como fuente con calidad y fecha. |
| 5. Próxima acción | ACTIVIDADES (Oportunidad ID), "Próximo hito" | Las vincula a la oportunidad, con fecha y prioridad | **Parcial.** El próximo hito (16/10) y la visita (22–24/10) salen de la ficha. **Las 3 actividades (ACT-049/050/051) no entran**: el CRM las tiene repetidas (filas 50–52 y 1201–1203, con textos distintos). |
| 6. Respuesta del contacto | ACTIVIDADES (Resultado, Fecha ejecución), RED \| CONTACTOS (Estado de relación) | La lee al sincronizar | En el CRM: probado (prueba del 8/10 en RUTA). Si se cuenta en la conversación ("le escribí", "confirmó la reunión", "se canceló"), queda en RELEVO, protegido, y en la lista para el CRM. **No se escribe en el Sheet.** |
| 7. Evaluación | OPORTUNIDADES (Confianza, Economía, Riesgo, Qué falta saber, Encaje) | La lee tal cual, sin puntuar | **OK.** |
| 8. Decisión | OPORTUNIDADES · Decisión | Vacía = "Pendiente (sin decisión registrada)" | **OK.** OP-001 = Pendiente (está escrito en el CRM). |

## La pregunta de prueba

> ¿Qué sabemos de Vaca Muerta Village, qué negocio nos proponen, qué riesgos identificamos y cuál es el próximo paso?

**Primer intento:** RELEVO abrió solo la empresa. Respondió bien (nada inventado), pero sin la ficha de OP-001. Se corrigió: la empresa ahora trae su oportunidad con la ficha del CRM completa, y la búsqueda encuentra oportunidades.

**Segundo intento (panel, conversación nueva):**
- Consultó la búsqueda, la oportunidad y la empresa.
- Respondió con la confianza baja, sin precio, contratos ni ocupación, y sin ticket de entrada.
- El negocio: compra de unidades o camas con pool; la alternativa es la asociación operativa, la de mayor encaje.
- El tamaño: 96 departamentos y 42 en la etapa 1, con las camas sin confirmar.
- Lo que se sabe de CB Developers y Piedrabuena, distinguiendo lo publicado de lo declarado (el inicio de obra según Nico Sanchez no es una certificación; el Radisson es otro desarrollo).
- Los 4 riesgos del CRM.
- El próximo paso: el dossier antes del 16/10 y la visita del 22 al 24/10.

Costo: USD 0,10, 10 segundos.

## Correcciones aplicadas (idempotentes)

`scripts/.contrato.tmp.mjs`: cada paso verifica el estado actual, no pisa cambios más nuevos del CRM, no marca contactos sin el registro del envío y no da de alta candidatos. La segunda corrida en seco omitió todo, con su motivo.

- **9 diferencias decididas:**
  - se conservan las correcciones de Tano (La Meseta, 7 departamentos, cancelación de El Pampita);
  - el CRM manda en lo automático (Vaca Muerta Facility Group, fecha de comprobación de las dos naves);
  - se conservan los títulos de los activos.
- **El Pampita:** la reunión del 7/10 y su parada quedaron canceladas, con historial; la tarea de reprogramar sigue abierta.
- **Raviola:** el dato del CRM y de AOG (CT-030 en PECOM) quedó marcado como desactualizado. No se borró ni se reasignó.
- **6 contactos con envío registrado:** quedan como contactados y protegidos. Ninguno se reenvió ni se marcó como reunión.
- **13 candidatos al CRM en cola, sin altas:** las 9 entidades de la IA, Enrique García, Chevron, Oldelval y CAPEX.
- **Consolidaciones:** AN-0121 → AN-0024 y AN-0021 → AN-0112 (AN-0096 → AN-0035 ya estaba). Las filas retenidas quedaron cerradas con su motivo.
- **Mission Master y Field Plan** configurados en la misión. Su título y fecha se van a leer cuando estén compartidos con la cuenta de servicio.
