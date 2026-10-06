# Field MVP · Bloque A — decisiones de dominio

Fecha: 06/10/2026. Migración `20261021120000_field_mvp_modelo.sql` (aditiva: el código anterior sigue funcionando).

## Parada (jornada de campo)
- Una parada es `empresa | persona | lugar | evento | zona | libre`. **Lugares, zonas y eventos son tipos de parada, no entidades** (nombre + lat/lng opcional). Una empresa exige su objetivo de misión; una persona, su contacto o un nombre; lo demás, un nombre. Regla en la base y en `src/domain/stops.ts`.
- Campos operables: fecha (del plan), orden, `target_time` u `time_slot` (texto: "Media mañana"), estado, `objective`, `key_question`, `outcome`, `external_ref` (RUTA-xx / MAP-xx / AN-xxxx para importar sin duplicar).
- Estados: se conservan los guardados y se suman `en_curso` y `cancelada`. Lectura de campo: planificada (programada/confirmada) · en curso · hecha (realizada) · salteada (no_realizada) · cancelada. No se renombró nada para no romper la confirmación de reuniones ni la agenda.
- Captura ↔ parada: `captures.stop_id`. Lo que se graba al salir de una parada deja sus próximas acciones ligadas a esa parada (`tasks.stop_id`).

## Próxima acción
- **La tarea es la implementación canónica** (responsable, fecha opcional, estado, vínculo a empresa/contacto/hallazgo/oportunidad/parada/activo). `nextAction()` en `src/server/next-action.ts`. Los campos de texto anteriores (`campaign_targets.next_action`, `opportunities.next_action`) se leen como respaldo; no se migraron.

## Precedencia humana
- `locked_fields` en empresas, contactos, establecimientos (además de activos). Una edición humana bloquea **solo los campos que cambió**. Una ingesta respeta el bloqueo; lo que llega distinto queda en `source_discrepancies` ("encontré información diferente": valor actual, valor entrante, fuente, estado pendiente/aceptada/descartada). Una sola discrepancia abierta por campo y valor.
- El importador del Radar ya la usa para activos. La reconciliación completa del Radar es Bloque B.

## Guardrail de promoción
- No bloquea. Al promover a hallazgo/caso sin evidencia, sin apoyos, sin casos independientes o con faltantes serios, avisa y pide confirmación con motivo opcional. La historia guarda usuario, hora, de qué a qué y el motivo ("Promovida sin evidencia suficiente: …").

## Candidato / oportunidad (sin entidades nuevas)
- Sobre `opportunities`: puede colgar de **empresa, activo, hallazgos o una brecha** (`gap`); ninguno es obligatorio (greenfield no tiene empresa).
- **Carril** `lane`: negocio existente | greenfield. **Ruta** (BUY/PARTNER/CREATE/CONNECT) sobre las existentes + `conexion`.
- **Madurez** explícita: candidato → cuantificando → validando → validada → caso de inversión. Separada del estado de gobierno (candidata/aprobada/rechazada) y del dealflow. **Validada exige la oportunidad aprobada** (que a su vez exige decisión registrada y un hallazgo aprobado).
- **Unidad económica** libre (`kg`, `cama/noche`, `vianda`…), sin formularios por vertical.
- **Ficha progresiva** (`card` jsonb, tipada en `src/domain/candidate.ts`): negocio, demanda, limitante, capacidad, palanca, economics, riesgos, próxima validación. Cada sección: sabido/creído/contradicho/falta + evidencia a favor y en contra + valores con base (observado/declarado/calculado/estimado; sin evidencia no hay "declarado"). Capacidad = valores (nominal, utilización, rechazada, futura —propia o de un competidor—, recurso limitante); responde "¿hay brecha?" y "¿sigue cuando entre la capacidad futura?".
- **Consumidor / decisor / pagador** (y operador, proveedor, competidor, socio potencial): `opportunity_parties`, relación con empresas o personas existentes, o una etiqueta genérica ("trabajador", "RR.HH.").
- La UX muestra solo: lo que sabemos, lo que falta, qué importa ahora, qué preguntar después (`candidateState`). Gates (Pain Map → Market Gap → Economics → Investment) **no** son workflow: la ficha permite evaluarlos después.

## Rol de red
- `contacts.network_roles`: dueño, operador, comprador, experto, originador, referidor (catálogo cerrado, varios por persona). Independiente del vínculo con su empresa.

## Criterio de éxito
El caso de la lavandería (700/1.000 kg/día, rechaza 200 en picos, hotel que necesita proveedor, X/kg, limitante equipamiento y capital de trabajo, dueño abierto a socio, competidor +500 kg/día) queda representado de punta a punta en `tests/db/field-mvp.test.ts` y `src/domain/field-mvp.test.ts`.
