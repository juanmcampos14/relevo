-- Misión Añelo como contexto (no un módulo): extensiones internas del modelo existente.
-- 1. Para qué hablamos con cada objetivo de la misión. Interno: no es una taxonomía visible ni un filtro.
alter table public.campaign_targets add column if not exists purpose text
  check (purpose in ('comprar_asociar', 'vender_crear', 'inteligencia'));
comment on column public.campaign_targets.purpose is 'comprar_asociar: dueños de negocios/activos; vender_crear: posibles compradores; inteligencia: entender cómo funciona el lugar.';

-- 2. Capa de discovery del análisis de una hipótesis: qué creemos, por qué, nivel de evidencia y quién puede
--    ayudar a validarla (ids verificados contra lo que el análisis vio).
alter table public.finding_assessments add column if not exists discovery jsonb;

-- 3. Línea de base antes del viaje: el análisis marcado como punto de partida de una misión, para comparar
--    después (confirma / contradice / línea nueva) sin un sistema de versiones visible.
alter table public.finding_assessments add column if not exists baseline_campaign_id uuid references public.campaigns (id) on delete set null;
create index if not exists finding_assessments_baseline_idx on public.finding_assessments (baseline_campaign_id) where baseline_campaign_id is not null;
