-- Cambio material: una sola pregunta ("¿esto cambia algo que importa para la misión?") gobierna la
-- vigilancia, la deduplicación, la síntesis, Avanzar, el Morning Brief y "Desde tu última visita".

-- 1. Señales: un hecho, varias fuentes. Una nota nueva sobre un hecho ya conocido queda como fuente más de
--    la señal original (event_id) y no es material salvo que aporte un dato nuevo (monto, fecha, operador…).
alter table public.brief_signals
  add column event_id uuid references public.brief_signals (id) on delete set null,
  add column material boolean not null default true;
create index brief_signals_event_idx on public.brief_signals (event_id) where event_id is not null;
create index brief_signals_material_idx on public.brief_signals (created_at desc) where material;
-- Lo que ya estaba: material = lo que cambia algo (no las re-confirmaciones ni lo de relevancia baja).
update public.brief_signals set material = (change in ('nuevo', 'actualizado', 'contradicho') and relevance in ('alta', 'media'));

-- 2. El trabajo de fondo que no se hizo porque no cambió nada también se registra (costo 0): así se mide
--    cuánto se ahorra y cuánto cuesta cada cambio útil detectado.
alter table public.ai_runs drop constraint ai_runs_status_check;
alter table public.ai_runs add constraint ai_runs_status_check check (status in ('ok', 'error', 'refused', 'limit', 'skipped'));

-- 3. Destinatarios del Morning Brief de la misión: cada miembro puede recibirlo (lo decide quien creó la
--    misión). Una investigación → un Brief → N destinatarios.
alter table public.campaign_members add column brief_email boolean not null default false;

-- 4. Eliminar una misión = archivarla: desaparece de las activas de todos, el trabajo de fondo la deja de
--    mirar y nada se borra (lo de la misión sigue siendo de la misión: no pasa a la memoria común). Se puede
--    deshacer. Solo quien creó la misión.
alter table public.campaigns
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id) on delete set null,
  add column archived_status text check (archived_status is null or archived_status in ('borrador', 'activa', 'pausada', 'finalizada'));

create or replace function public.campaigns_archive_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  -- El trabajo de fondo (sin usuario) puede; una persona, solo si es quien creó la misión.
  if new.archived_at is distinct from old.archived_at and auth.uid() is not null and not public.is_campaign_owner(old.id) then
    raise exception 'Solo quien creó la misión puede eliminarla' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger campaigns_archive_guard before update of archived_at on public.campaigns
  for each row execute function public.campaigns_archive_guard();

create or replace function public.archive_mission(p_campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_campaign_owner(p_campaign) then
    raise exception 'Solo quien creó la misión puede eliminarla' using errcode = '42501';
  end if;
  update public.campaigns
     set archived_status = status, status = 'finalizada', archived_at = now(), archived_by = auth.uid()
   where id = p_campaign and archived_at is null;
end;
$$;

create or replace function public.restore_mission(p_campaign uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_campaign_owner(p_campaign) then
    raise exception 'Solo quien creó la misión puede recuperarla' using errcode = '42501';
  end if;
  update public.campaigns
     set status = coalesce(archived_status, 'activa'), archived_status = null, archived_at = null, archived_by = null
   where id = p_campaign and archived_at is not null;
end;
$$;
revoke execute on function public.archive_mission(uuid), public.restore_mission(uuid) from public, anon;
grant execute on function public.archive_mission(uuid), public.restore_mission(uuid) to authenticated;
