-- =============================================================================
-- 0008 · Captura rápida (+ Capturar) y ubicación no verificada.
-- Una captura es material crudo (texto, foto, audio, ubicación) guardado en
-- segundos, sin decidir todavía a qué entidad pertenece. Nace en el teléfono con
-- un client_id: reintentar la subida nunca la duplica. Nada de lo que contiene es
-- un hecho: se estructura después y pasa por revisión humana.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ubicación: un punto se puede registrar sin dirección verificada (V13 §12).
-- ---------------------------------------------------------------------------
create or replace function public.is_location_status(s text) returns boolean
language sql immutable as $$ select s in ('verified', 'approximate', 'gps_captured', 'unverified') $$;

do $$
declare
  t text;
begin
  -- Establecimientos y activos: mismas reglas de ubicación.
  foreach t in array array['establishments', 'assets'] loop
    execute format('alter table public.%1$I
      drop constraint %1$s_check2,
      add column location_status     text check (location_status is null or public.is_location_status(location_status)),
      add column location_accuracy_m real check (location_accuracy_m is null or location_accuracy_m >= 0),
      add column location_source     text', t);
    -- Hasta hoy la base solo aceptaba coordenadas verificadas.
    execute format('update public.%I set location_status = ''verified'' where latitude is not null', t);
    execute format('alter table public.%1$I
      add constraint %1$s_location_status_coords check ((latitude is null) = (location_status is null)),
      add constraint %1$s_location_verified check (location_status is distinct from ''verified'' or location_verified_at is not null)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Capturas
-- ---------------------------------------------------------------------------
create table public.captures (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  client_id           uuid not null,
  body                text,
  captured_at         timestamptz not null,
  captured_by         uuid references auth.users (id) on delete set null default auth.uid(),
  latitude            double precision check (latitude between -90 and 90),
  longitude           double precision check (longitude between -180 and 180),
  location_accuracy_m real check (location_accuracy_m is null or location_accuracy_m >= 0),
  location_status     text check (location_status is null or public.is_location_status(location_status)),
  campaign_id         uuid,
  ai_consent          boolean not null default false,
  status              text not null default 'guardado'
                       check (status in ('guardado', 'procesando', 'transcripto', 'propuestas_listas', 'revisado', 'error')),
  status_error        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, client_id),
  check ((latitude is null) = (longitude is null)),
  check ((latitude is null) = (location_status is null)),
  check (status <> 'error' or coalesce(trim(status_error), '') <> ''),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id)
);
create index captures_recent_idx on public.captures (workspace_id, captured_at desc);
create index captures_status_idx on public.captures (workspace_id, status);

create table public.capture_media (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  capture_id    uuid not null,
  kind          text not null check (kind in ('photo', 'audio')),
  storage_path  text not null unique,
  mime_type     text not null,
  size_bytes    integer check (size_bytes is null or size_bytes >= 0),
  duration_ms   integer check (duration_ms is null or duration_ms >= 0),
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  check (split_part(storage_path, '/', 1) = workspace_id::text),
  foreign key (workspace_id, capture_id) references public.captures (workspace_id, id) on delete cascade
);
create index capture_media_capture_idx on public.capture_media (capture_id);

create trigger captures_set_updated_at before update on public.captures
  for each row execute function public.set_updated_at();
create trigger audit_captures after insert or update or delete on public.captures
  for each row execute function public.audit_row();

alter table public.captures enable row level security;
alter table public.capture_media enable row level security;

create policy captures_select on public.captures for select using (public.is_member(workspace_id));
create policy captures_insert on public.captures for insert
  with check (public.can_edit(workspace_id) and captured_by = auth.uid());
create policy captures_update on public.captures for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy captures_delete on public.captures for delete
  using (public.has_role(workspace_id, array['owner', 'admin']));

create policy capture_media_select on public.capture_media for select using (public.is_member(workspace_id));
create policy capture_media_insert on public.capture_media for insert with check (public.can_edit(workspace_id));
create policy capture_media_delete on public.capture_media for delete
  using (public.has_role(workspace_id, array['owner', 'admin']));

-- Alta atómica e idempotente: la captura y sus archivos aparecen juntos o no aparecen.
-- Corre con los permisos de quien llama (RLS). Reintentar devuelve la misma captura.
create or replace function public.create_capture(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  ws   uuid := (p ->> 'workspace_id')::uuid;
  cid  uuid := (p ->> 'client_id')::uuid;
  lat  double precision := (p ->> 'latitude')::double precision;
  out_id uuid;
  m    jsonb;
begin
  if coalesce(trim(p ->> 'body'), '') = '' and lat is null
     and coalesce(jsonb_array_length(p -> 'media'), 0) = 0 then
    raise exception 'La captura está vacía' using errcode = '23514';
  end if;

  insert into public.captures (workspace_id, client_id, body, captured_at, latitude, longitude,
                               location_accuracy_m, location_status, campaign_id, ai_consent)
  values (ws, cid, nullif(trim(p ->> 'body'), ''), (p ->> 'captured_at')::timestamptz, lat,
          (p ->> 'longitude')::double precision, (p ->> 'location_accuracy_m')::real,
          case when lat is null then null else 'gps_captured' end,
          (p ->> 'campaign_id')::uuid, coalesce((p ->> 'ai_consent')::boolean, false))
  on conflict (workspace_id, client_id) do nothing;

  select id into out_id from public.captures where workspace_id = ws and client_id = cid;

  for m in select * from jsonb_array_elements(coalesce(p -> 'media', '[]'::jsonb)) loop
    insert into public.capture_media (workspace_id, capture_id, kind, storage_path, mime_type, size_bytes, duration_ms)
    values (ws, out_id, m ->> 'kind', m ->> 'storage_path', m ->> 'mime_type',
            (m ->> 'size_bytes')::integer, (m ->> 'duration_ms')::integer)
    on conflict (storage_path) do nothing;
  end loop;

  return out_id;
end $$;
revoke execute on function public.create_capture(jsonb) from public, anon;
grant execute on function public.create_capture(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Archivos: bucket privado, carpeta por workspace (<workspace_id>/<client_id>/<archivo>).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
              'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
on conflict (id) do nothing;

create or replace function public.storage_workspace(object_name text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end $$;

create policy captures_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'captures' and public.is_member(public.storage_workspace(name)));
create policy captures_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and public.can_edit(public.storage_workspace(name)));
create policy captures_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and public.has_role(public.storage_workspace(name), array['owner', 'admin']));
