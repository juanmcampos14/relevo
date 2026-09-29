-- =============================================================================
-- 0014 · Semántica de evidencia y activos propuestos desde capturas
-- - Observé algo ≠ una fuente afirma algo ≠ verifiqué el dato. `declared_by` guarda quién o qué
--   afirma el contenido cuando no es una persona registrada ("aviso de alquiler observado en campo").
-- - Una captura puede proponer un ACTIVO (local, terreno, galpón…), no solo una empresa.
-- =============================================================================
alter table public.evidence add column declared_by text;

alter table public.proposals drop constraint proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check
  check (kind in ('company', 'asset', 'person', 'evidence', 'finding', 'next_action'));
alter table public.proposals drop constraint proposals_result_type_check;
alter table public.proposals add constraint proposals_result_type_check
  check (result_type is null or result_type in ('company', 'asset', 'contact', 'evidence', 'finding', 'task'));
