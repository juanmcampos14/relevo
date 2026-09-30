-- =============================================================================
-- 0018 · Misión ≠ proyectos, cifras con unidad y evidencia web con aprobación
-- - La misión (Añelo / Vaca Muerta) es una sola y transversal; los proyectos (Mountain Suites, Hielo,
--   un terreno) usan la misma estructura (objetivos, capturas, hipótesis, tareas) con kind = 'proyecto'.
--   Mountain Suites y Hielo se convierten sin mover ningún dato (confirmado por Tano el 01/10).
-- - La evidencia guarda la cifra principal con su unidad (USD 380.000, 2.400 m², 35 personas) para
--   calcular sin IA (USD/m², variación contra referencias).
-- - El asistente puede proponer guardar lo que encontró en la web como fuente + evidencia (con URL).
-- =============================================================================
alter table public.campaigns add column kind text not null default 'mision' check (kind in ('mision', 'proyecto'));
update public.campaigns set kind = 'proyecto' where lower(trim(name)) like 'mountain suites%' or lower(trim(name)) like 'hielo%';

alter table public.evidence
  add column value_number   numeric,
  add column value_unit     text check (value_unit is null or value_unit in ('moneda', 'm2', 'personas', 'porcentaje', 'unidades', 'dias')),
  add column value_currency text check (value_currency is null or value_currency in ('ARS', 'USD'));

alter table public.ai_action_drafts drop constraint ai_action_drafts_action_check;
alter table public.ai_action_drafts add constraint ai_action_drafts_action_check
  check (action in ('create_task', 'draft_finding', 'request_decision', 'link_evidence', 'update_next_action', 'request_help', 'prepare_validation', 'record_web_evidence'));
