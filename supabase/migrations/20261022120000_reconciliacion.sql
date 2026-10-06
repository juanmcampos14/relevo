-- Field MVP · Bloque B (ingesta): una fuente nueva no se importa, se reconcilia contra lo que RELEVO ya sabe.

-- 1. Triage de lo que entra: ¿qué merece atención ahora? Reusa el estado de la señal (que no se usaba):
--    nueva (sin triage) · incorporada (IMPORTA: material, cambia algo) · seguida (SEGUIR: vigilar) ·
--    procesada (NEXT: entendido, no requiere acción; queda en memoria) · descartada (DESCARTAR: no relevante).
alter table public.brief_signals drop constraint brief_signals_status_check;
alter table public.brief_signals add constraint brief_signals_status_check check (status in ('nueva', 'seguida', 'descartada', 'incorporada', 'procesada'));
alter table public.brief_signals
  add column triaged_by     uuid references auth.users (id) on delete set null,
  add column triaged_at     timestamptz,
  add column triage_reason  text;

-- 2. La próxima acción que nace de una señal sabe de qué señal nació (el vínculo señal → tarea).
alter table public.tasks add column signal_id uuid references public.brief_signals (id) on delete set null;

-- 3. Cada fuente reconciliada deja su registro fila por fila (qué encontró, contra qué lo reconcilió, qué
--    creó, qué actualizó, qué contradicción, qué impacto, qué no creó, qué requiere revisión), reusando los
--    lotes de importación del CRM.
alter table public.import_batches drop constraint import_batches_source_system_check;
alter table public.import_batches add constraint import_batches_source_system_check check (source_system in ('google_sheets', 'radar', 'documento'));
alter table public.import_rows drop constraint import_rows_entity_type_check;
alter table public.import_rows add constraint import_rows_entity_type_check check (entity_type in ('company', 'contact', 'task', 'source', 'signal', 'asset', 'fact'));
