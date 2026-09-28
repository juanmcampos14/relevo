-- =============================================================================
-- 0001 · Tenancy: workspaces, memberships, capacidades, invitaciones, perfiles,
-- preferencias y audit log append-only.
-- Adaptado de RUN72-monorepo (@run72/organizations, @run72/roles, @run72/audit):
--   organizations → workspaces; roles owner/admin/member/viewer;
--   capacidad explícita can_approve_decisions (independiente del rol).
-- Regla: las preferencias de usuario NUNCA autorizan nada; la autorización vive
-- solo en memberships + RLS.
-- =============================================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Workspaces (tenant raíz)
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  status      text not null default 'active' check (status in ('active', 'archived')),
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Memberships
-- -----------------------------------------------------------------------------
create table public.memberships (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  user_id                uuid not null references auth.users (id) on delete cascade,
  role                   text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  -- Capacidad explícita, NO derivada del rol. Un viewer nunca puede aprobar.
  can_approve_decisions  boolean not null default false,
  status                 text not null default 'active' check (status in ('active', 'archived')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (workspace_id, user_id),
  constraint viewer_cannot_approve check (not (role = 'viewer' and can_approve_decisions))
);
create index memberships_user_idx on public.memberships (user_id);
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Predicados (security definer, search_path fijo; sin recursión de RLS)
-- -----------------------------------------------------------------------------
create or replace function public.is_member(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.has_role(ws uuid, roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and m.status = 'active' and m.role = any (roles)
  );
$$;

-- Puede crear/editar registros operativos (todo rol salvo viewer).
create or replace function public.can_edit(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role(ws, array['owner', 'admin', 'member']);
$$;

create or replace function public.can_approve(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid()
      and m.status = 'active' and m.can_approve_decisions
  );
$$;

-- ¿Comparte al menos un workspace con este usuario? (para leer perfiles)
create or replace function public.shares_workspace_with(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other
      and a.status = 'active' and b.status = 'active'
  );
$$;

revoke execute on function public.is_member(uuid), public.has_role(uuid, text[]),
  public.can_edit(uuid), public.can_approve(uuid), public.shares_workspace_with(uuid)
  from public, anon;
grant execute on function public.is_member(uuid), public.has_role(uuid, text[]),
  public.can_edit(uuid), public.can_approve(uuid), public.shares_workspace_with(uuid)
  to authenticated;

alter table public.workspaces  enable row level security;
alter table public.memberships enable row level security;

create policy workspaces_select on public.workspaces for select
  using (public.is_member(id));
create policy workspaces_update on public.workspaces for update
  using (public.has_role(id, array['owner']))
  with check (public.has_role(id, array['owner']));
-- Alta de workspaces: solo desde servidor (service role). Sin policy de insert.

create policy memberships_select on public.memberships for select
  using (public.is_member(workspace_id));
create policy memberships_owner_manage on public.memberships for all
  using (public.has_role(workspace_id, array['owner']))
  with check (public.has_role(workspace_id, array['owner']));

-- -----------------------------------------------------------------------------
-- Perfiles (nombre visible); se crean al alta de auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select
  using (user_id = auth.uid() or public.shares_workspace_with(user_id));
create policy profiles_update_self on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Invitaciones (alta pública deshabilitada: solo por invitación)
-- -----------------------------------------------------------------------------
create table public.workspace_invitations (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  email                  text not null check (email = lower(email) and position('@' in email) > 1),
  role                   text not null check (role in ('admin', 'member', 'viewer')),
  can_approve_decisions  boolean not null default false,
  invited_by             uuid references auth.users (id) on delete set null,
  status                 text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by            uuid references auth.users (id) on delete set null,
  accepted_at            timestamptz,
  expires_at             timestamptz not null default now() + interval '14 days',
  created_at             timestamptz not null default now(),
  constraint invite_viewer_cannot_approve check (not (role = 'viewer' and can_approve_decisions))
);
create unique index workspace_invitations_pending_uniq
  on public.workspace_invitations (workspace_id, email) where status = 'pending';

alter table public.workspace_invitations enable row level security;
create policy invitations_select on public.workspace_invitations for select
  using (public.has_role(workspace_id, array['owner', 'admin']));
create policy invitations_insert on public.workspace_invitations for insert
  with check (
    public.has_role(workspace_id, array['owner', 'admin'])
    and invited_by = auth.uid()
    -- Solo el owner puede invitar con capacidad de aprobar.
    and (not can_approve_decisions or public.has_role(workspace_id, array['owner']))
  );
create policy invitations_revoke on public.workspace_invitations for update
  using (public.has_role(workspace_id, array['owner', 'admin']))
  with check (public.has_role(workspace_id, array['owner', 'admin']) and status in ('pending', 'revoked'));

-- El usuario autenticado acepta las invitaciones pendientes dirigidas a su email.
create or replace function public.accept_pending_invitations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_count integer := 0;
  inv record;
begin
  if auth.uid() is null or v_email = '' then
    return 0;
  end if;
  for inv in
    select * from public.workspace_invitations
    where email = v_email and status = 'pending' and expires_at > now()
    for update
  loop
    insert into public.memberships (workspace_id, user_id, role, can_approve_decisions)
    values (inv.workspace_id, auth.uid(), inv.role, inv.can_approve_decisions)
    on conflict (workspace_id, user_id) do nothing;
    update public.workspace_invitations
      set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
      where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.accept_pending_invitations() from public, anon;
grant execute on function public.accept_pending_invitations() to authenticated;

-- -----------------------------------------------------------------------------
-- Preferencias por usuario (inicio, widgets, intereses). NO son autorización.
-- -----------------------------------------------------------------------------
create table public.user_preferences (
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  home          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now(),
  primary key (user_id, workspace_id)
);
alter table public.user_preferences enable row level security;
create policy user_preferences_self on public.user_preferences for all
  using (user_id = auth.uid() and public.is_member(workspace_id))
  with check (user_id = auth.uid() and public.is_member(workspace_id));

-- -----------------------------------------------------------------------------
-- Audit log append-only (patrón @run72/audit) + trigger genérico
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  -- Sin FK: el registro debe sobrevivir incluso al borrado del workspace.
  workspace_id  uuid,
  actor_id      uuid,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  changes       jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_ws_time_idx on public.audit_log (workspace_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log es append-only: % prohibido', tg_op;
end $$;
create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

alter table public.audit_log enable row level security;
-- Acceso completo por defecto: todos los miembros leen la auditoría.
create policy audit_log_select on public.audit_log for select
  using (public.is_member(workspace_id));
-- Sin policy de insert: solo escribe el trigger (security definer).

-- Registra INSERT/UPDATE/DELETE con autor, hora y solo los campos cambiados.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_changes jsonb;
  v_ws uuid;
  v_id uuid;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('de', v_old -> n.key, 'a', n.value)), '{}'::jsonb)
      into v_changes
      from jsonb_each(v_new) n
      where n.key not in ('updated_at') and (v_old -> n.key) is distinct from n.value;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new;
  else
    v_changes := v_old;
  end if;

  v_ws := coalesce(v_new, v_old) ->> 'workspace_id';
  if tg_table_name = 'workspaces' then
    v_ws := coalesce(v_new, v_old) ->> 'id';
  end if;
  v_id := nullif(coalesce(v_new, v_old) ->> 'id', '')::uuid;

  insert into public.audit_log (workspace_id, actor_id, action, entity_type, entity_id, changes)
  values (v_ws, auth.uid(), lower(tg_op), tg_table_name, v_id, v_changes);
  return coalesce(new, old);
end $$;

create trigger audit_workspaces after insert or update or delete on public.workspaces
  for each row execute function public.audit_row();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function public.audit_row();
create trigger audit_invitations after insert or update or delete on public.workspace_invitations
  for each row execute function public.audit_row();
