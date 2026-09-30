-- =============================================================================
-- 0016 · Casos en estudio y economía conocida
-- - Un caso en estudio es un nivel más de madurez de la misma hipótesis (idea → hipótesis → finding →
--   caso): conserva su evidencia, contraevidencia e historia. La oportunidad sigue siendo otra promoción.
-- - La economía se guarda en cada evaluación: variable, valor, base (observado / declarado / calculado /
--   estimado) y evidencia citada. Lo que no figura es desconocido.
-- =============================================================================
alter table public.findings drop constraint findings_maturity_check;
alter table public.findings add constraint findings_maturity_check check (maturity in ('idea', 'hipotesis', 'finding', 'caso'));

alter table public.finding_assessments add column economics jsonb not null default '[]';
