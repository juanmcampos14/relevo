# Field MVP · Bloque B — reconciliación (decisiones de dominio)

Fecha: 06/10/2026. Migración `20261022120000_reconciliacion.sql`. Código: `src/domain/reconcile.ts`, `src/server/reconcile/{engine,source}.ts`, `src/server/radar/reconcile.ts`.

**Premisa:** una fuente nueva no se importa, se reconcilia. Fuente → hechos → identidad de entidades → ¿hecho conocido o nuevo? → materialidad (con el contexto de la misión) → impacto sobre candidatos → triage → próxima acción. Nada se promueve a oportunidad ni se descarta solo.

## Decisiones
- **Identidad semántica** (`entityKey` / `entityMatch`): se ignoran forma jurídica, localidad y rótulos genéricos ("Lavandería X" = "… Añelo" = "… SRL"). misma → se vincula; posible (comparten la palabra distintiva) → se pregunta (cola existente "¿es la misma?"); nunca se une solo. La vigilancia usa la misma regla.
- **Mismo hecho**: si juzgó el modelo, manda su lectura (la regla fija confundía publicaciones distintas y notas que comparten palabras: caso real del 06/10). La regla queda como red cuando no hay juicio. Un hecho conocido entra como fuente más (`event_id`); si trae un dato nuevo queda como actualización (con el detalle), y es material solo si el juicio dice que cambia algo.
- **Mismo activo** (`sameListing`): misma ficha de portal, o misma superficie (±5 %), operación y zona **y** que hablen de lo mismo (galpón con galpón). Un índice de portal no identifica un activo. Una publicación nunca es "mismo hecho" por regla.
- **La columna "entidad" del Radar** trae temas ("Plan vial RP8…"), no actores: solo vincula si ya existe; no crea ni pregunta.
- **Entidades nuevas** se crean solo si el hecho es material; si no, se registra "no creado (no cambia nada todavía)".
- **Impacto sobre candidatos** (`candidateImpact`): compara la ficha antes/después (brecha de capacidad, secciones contradichas) y dice qué sabía, qué aprendió, qué cambia, qué se debilitó/reforzó, qué sigue sin saberse y qué preguntar. Un dato sobre otra empresa (un competidor que suma capacidad) es **evidencia en contra** de la brecha propia y suma al competidor como parte del candidato. Si cambia algo → tarea canónica "Validar…" (con `opportunity_id` y `signal_id`).
- **Triage** sobre el estado que ya tenía la señal: IMPORTA = incorporada (material; deja su próxima acción) · SEGUIR = seguida (pedido de aviso con su sujeto) · NEXT = procesada (entendido; sale del trabajo activo y queda en memoria) · DESCARTAR = descartada. RELEVO propone; lo que propone como "importa" aparece en **Merece tu atención** (Radar) hasta que una persona lo confirme. No son carpetas.
- **Información diferente** (Bloque A) se decide en el mismo lugar: "Mantener lo actual" / "Usar el dato nuevo" (aceptar aplica el dato y queda bloqueado).
- **Registro**: cada fuente deja un lote (`import_batches`, `source_system` radar | documento) con una fila por hecho: qué encontró, contra qué lo reconcilió, qué creó, qué actualizó, qué fuente agregó, qué contradicción, qué impacto, qué no creó, qué requiere revisión.
- **Radar ≠ agenda**: el Radar no crea paradas. Una señal puede terminar en una tarea ("visitar X"); la tarea puede volverse parada (Bloque C).
- **Documentos** (`ingestDocument`): extracción de hechos (sin inventar números) → la misma reconciliación. El disparador desde la Surface (subir/pegar un documento) es Bloque C.
