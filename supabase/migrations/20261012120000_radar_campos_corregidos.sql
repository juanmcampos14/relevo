-- Correcciones manuales de un activo del Radar (p. ej. RAD-ACT-03/04, 01/10): los campos listados acá no
-- los pisa una reimportación del Sheet mientras dure la transición.
alter table public.assets add column if not exists locked_fields text[] not null default '{}';
comment on column public.assets.locked_fields is 'Campos corregidos en RELEVO que la reimportación del RADAR del Sheet no pisa.';
