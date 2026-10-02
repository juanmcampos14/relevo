-- Colaboración mínima: la unidad que se comparte es la misión.
-- Cada persona ve sus misiones; cada misión tiene owner y miembros (owner · member · viewer). El Brain de una
-- misión compartida es uno solo. La memoria es común, pero los permisos no se cruzan: lo que nace en una misión
-- privada no se ve desde otra, aunque la inteligencia detecte la conexión. Las reglas viven en la base
-- (políticas RESTRICTIVE encima de las de workspace), así ningún camino puede filtrar una misión privada.

-- 1. Miembros de cada misión.
create table public.campaign_members (
  campaign_id   uuid not null,
  workspace_id  uuid not null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('owner', 'member', 'viewer')),
  invited_by    uuid references auth.users (id) on delete set null,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz,
  primary key (campaign_id, user_id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete cascade
);
create index campaign_members_user_idx on public.campaign_members (user_id);

-- 2. Invitaciones a una misión (por email; se aceptan al entrar, como las del workspace).
create table public.mission_invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  campaign_id   uuid not null,
  email         text not null check (email = lower(email) and position('@' in email) > 1),
  role          text not null check (role in ('member', 'viewer')),
  invited_by    uuid references auth.users (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by   uuid references auth.users (id) on delete set null,
  accepted_at   timestamptz,
  expires_at    timestamptz not null default now() + interval '30 days',
  created_at    timestamptz not null default now(),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete cascade
);
create unique index mission_invitations_pending_uniq on public.mission_invitations (campaign_id, email) where status = 'pending';

-- 3. Quién puede ver y trabajar en qué misión (security definer: sin recursión de políticas).
create or replace function public.campaign_role(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.campaign_members m where m.campaign_id = c and m.user_id = auth.uid();
$$;
-- Una campaña sin ningún miembro (datos previos, importaciones) es del equipo: la ve el workspace.
create or replace function public.campaign_unclaimed(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.campaign_members m where m.campaign_id = c);
$$;
create or replace function public.can_see_campaign(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is null or public.campaign_unclaimed(c) or exists (select 1 from public.campaign_members m where m.campaign_id = c and m.user_id = auth.uid());
$$;
create or replace function public.can_work_campaign(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is null or public.campaign_unclaimed(c) or exists (select 1 from public.campaign_members m where m.campaign_id = c and m.user_id = auth.uid() and m.role in ('owner', 'member'));
$$;
create or replace function public.is_campaign_owner(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campaign_members m where m.campaign_id = c and m.user_id = auth.uid() and m.role = 'owner')
    or (public.campaign_unclaimed(c) and exists (select 1 from public.campaigns x where x.id = c and public.has_role(x.workspace_id, array['owner', 'admin'])));
$$;
create or replace function public.can_see_any_campaign(ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select cardinality(ids) = 0 or exists (select 1 from unnest(ids) c where public.can_see_campaign(c));
$$;
create or replace function public.finding_visible(f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select f is null or exists (select 1 from public.findings x where x.id = f and public.can_see_campaign(x.campaign_id));
$$;
create or replace function public.finding_workable(f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select f is null or exists (select 1 from public.findings x where x.id = f and public.can_work_campaign(x.campaign_id));
$$;
create or replace function public.capture_visible(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is null or exists (select 1 from public.captures x where x.id = c and public.can_see_campaign(x.campaign_id));
$$;
create or replace function public.capture_workable(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c is null or exists (select 1 from public.captures x where x.id = c and public.can_work_campaign(x.campaign_id));
$$;
create or replace function public.plan_visible(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p is null or exists (select 1 from public.visit_plans x where x.id = p and public.can_see_campaign(x.campaign_id));
$$;
-- Una entidad de la memoria (empresa, persona, activo, lugar) se ve si es memoria común (no nació en una
-- misión), si nació en una misión propia, o si una misión propia la sigue.
create or replace function public.entity_visible(p_origin uuid, p_col text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_origin is null or public.can_see_campaign(p_origin) then return true; end if;
  if p_col = 'company_id' then
    return exists (select 1 from public.campaign_targets t where t.company_id = p_id and public.can_see_campaign(t.campaign_id));
  elsif p_col = 'asset_id' then
    return exists (select 1 from public.campaign_targets t where t.asset_id = p_id and public.can_see_campaign(t.campaign_id));
  elsif p_col = 'establishment_id' then
    return exists (select 1 from public.campaign_targets t where t.establishment_id = p_id and public.can_see_campaign(t.campaign_id));
  end if;
  return false;
end $$;
revoke execute on function public.campaign_unclaimed(uuid) from public, anon;
grant execute on function public.campaign_unclaimed(uuid) to authenticated;
revoke execute on function public.campaign_role(uuid), public.can_see_campaign(uuid), public.can_work_campaign(uuid), public.is_campaign_owner(uuid),
  public.can_see_any_campaign(uuid[]), public.finding_visible(uuid), public.finding_workable(uuid), public.capture_visible(uuid), public.capture_workable(uuid),
  public.plan_visible(uuid), public.entity_visible(uuid, text, uuid) from public, anon;
grant execute on function public.campaign_role(uuid), public.can_see_campaign(uuid), public.can_work_campaign(uuid), public.is_campaign_owner(uuid),
  public.can_see_any_campaign(uuid[]), public.finding_visible(uuid), public.finding_workable(uuid), public.capture_visible(uuid), public.capture_workable(uuid),
  public.plan_visible(uuid), public.entity_visible(uuid, text, uuid) to authenticated;

-- 4. Dónde nació cada entidad de la memoria (null = memoria común).
alter table public.companies add column origin_campaign_id uuid,
  add constraint companies_origin_fk foreign key (workspace_id, origin_campaign_id) references public.campaigns (workspace_id, id) on delete set null (origin_campaign_id);
alter table public.contacts add column origin_campaign_id uuid,
  add constraint contacts_origin_fk foreign key (workspace_id, origin_campaign_id) references public.campaigns (workspace_id, id) on delete set null (origin_campaign_id);
alter table public.assets add column origin_campaign_id uuid,
  add constraint assets_origin_fk foreign key (workspace_id, origin_campaign_id) references public.campaigns (workspace_id, id) on delete set null (origin_campaign_id);
alter table public.establishments add column origin_campaign_id uuid,
  add constraint establishments_origin_fk foreign key (workspace_id, origin_campaign_id) references public.campaigns (workspace_id, id) on delete set null (origin_campaign_id);

-- 5. Políticas: las de workspace siguen; estas se suman (RESTRICTIVE = además de).
alter table public.campaign_members enable row level security;
create policy campaign_members_select on public.campaign_members for select using (public.is_member(workspace_id) and public.can_see_campaign(campaign_id));
create policy campaign_members_owner_insert on public.campaign_members for insert with check (public.is_member(workspace_id) and public.is_campaign_owner(campaign_id));
create policy campaign_members_owner_update on public.campaign_members for update using (public.is_campaign_owner(campaign_id) or user_id = auth.uid()) with check (public.is_campaign_owner(campaign_id) or (user_id = auth.uid() and role = public.campaign_role(campaign_id)));
create policy campaign_members_owner_delete on public.campaign_members for delete using (public.is_campaign_owner(campaign_id) and user_id <> auth.uid());

alter table public.mission_invitations enable row level security;
create policy mission_invitations_owner on public.mission_invitations for all using (public.is_campaign_owner(campaign_id)) with check (public.is_campaign_owner(campaign_id));

create policy campaigns_mission_select on public.campaigns as restrictive for select using (public.can_see_campaign(id));
create policy campaigns_mission_update on public.campaigns as restrictive for update using (public.can_work_campaign(id)) with check (public.can_work_campaign(id));
create policy campaigns_mission_delete on public.campaigns as restrictive for delete using (public.is_campaign_owner(id));

do $$
declare t text;
begin
  -- Lo que nace en una misión.
  foreach t in array array['findings', 'captures', 'evidence', 'tasks', 'campaign_targets', 'visit_plans', 'opportunities', 'context_documents', 'research_questions', 'brief_candidates'] loop
    execute format('create policy %I on public.%I as restrictive for select using (public.can_see_campaign(campaign_id))', t || '_mission_select', t);
    execute format('create policy %I on public.%I as restrictive for insert with check (public.can_work_campaign(campaign_id))', t || '_mission_insert', t);
    execute format('create policy %I on public.%I as restrictive for update using (public.can_work_campaign(campaign_id)) with check (public.can_work_campaign(campaign_id))', t || '_mission_update', t);
    execute format('create policy %I on public.%I as restrictive for delete using (public.can_work_campaign(campaign_id))', t || '_mission_delete', t);
  end loop;
  -- Lo que cuelga de una hipótesis.
  foreach t in array array['finding_assessments', 'finding_evidence', 'finding_companies', 'finding_revisions', 'question_findings', 'opportunity_findings', 'help_requests'] loop
    execute format('create policy %I on public.%I as restrictive for select using (public.finding_visible(finding_id))', t || '_mission_select', t);
    execute format('create policy %I on public.%I as restrictive for insert with check (public.finding_workable(finding_id))', t || '_mission_insert', t);
    execute format('create policy %I on public.%I as restrictive for update using (public.finding_workable(finding_id))', t || '_mission_update', t);
    execute format('create policy %I on public.%I as restrictive for delete using (public.finding_workable(finding_id))', t || '_mission_delete', t);
  end loop;
  -- Lo que cuelga de una captura.
  foreach t in array array['proposals', 'capture_media', 'transcripts'] loop
    execute format('create policy %I on public.%I as restrictive for select using (public.capture_visible(capture_id))', t || '_mission_select', t);
    execute format('create policy %I on public.%I as restrictive for insert with check (public.capture_workable(capture_id))', t || '_mission_insert', t);
    execute format('create policy %I on public.%I as restrictive for update using (public.capture_workable(capture_id))', t || '_mission_update', t);
    execute format('create policy %I on public.%I as restrictive for delete using (public.capture_workable(capture_id))', t || '_mission_delete', t);
  end loop;
end $$;

create policy visit_stops_mission_select on public.visit_stops as restrictive for select using (public.plan_visible(plan_id));
create policy brief_signals_mission_select on public.brief_signals as restrictive for select using (public.can_see_any_campaign(campaign_ids));

-- La memoria: común, salvo lo que nació en una misión que no es tuya.
create policy companies_mission_select on public.companies as restrictive for select using (public.entity_visible(origin_campaign_id, 'company_id', id));
create policy contacts_mission_select on public.contacts as restrictive for select using (public.entity_visible(origin_campaign_id, 'contact_id', id));
create policy assets_mission_select on public.assets as restrictive for select using (public.entity_visible(origin_campaign_id, 'asset_id', id));
create policy establishments_mission_select on public.establishments as restrictive for select using (public.entity_visible(origin_campaign_id, 'establishment_id', id));

-- Las acciones automáticas (sin conversación) son de su misión.
create policy ai_action_drafts_mission_select on public.ai_action_drafts as restrictive for select
  using (conversation_id is not null or (after_state ->> 'mission_id') is null or public.can_see_campaign((after_state ->> 'mission_id')::uuid));

-- 6. Quien crea una misión es su owner (nace privada).
create or replace function public.campaign_owner_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid := coalesce(auth.uid(), new.created_by);
begin
  if v_user is not null then
    insert into public.campaign_members (campaign_id, workspace_id, user_id, role) values (new.id, new.workspace_id, v_user, 'owner') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger campaigns_owner_on_insert after insert on public.campaigns for each row execute function public.campaign_owner_on_insert();

-- 7. Invitaciones: al entrar, se aceptan las del workspace y las de misión (la de misión trae la membresía).
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
    update public.workspace_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
    v_count := v_count + 1;
  end loop;
  for inv in
    select * from public.mission_invitations
    where email = v_email and status = 'pending' and expires_at > now()
    for update
  loop
    insert into public.memberships (workspace_id, user_id, role)
    values (inv.workspace_id, auth.uid(), 'member')
    on conflict (workspace_id, user_id) do nothing;
    insert into public.campaign_members (campaign_id, workspace_id, user_id, role, invited_by)
    values (inv.campaign_id, inv.workspace_id, auth.uid(), inv.role, inv.invited_by)
    on conflict (campaign_id, user_id) do update set role = excluded.role;
    update public.mission_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.accept_pending_invitations() from public, anon;
grant execute on function public.accept_pending_invitations() to authenticated;

-- 8. Lo que ya existe: el owner de cada misión es quien la creó (o el owner del workspace). Las misiones de
--    antes de las misiones privadas (hasta el 1/10) eran del equipo: entran todos sus miembros. Las nuevas,
--    privadas de quien las creó.
insert into public.campaign_members (campaign_id, workspace_id, user_id, role, last_seen_at)
select c.id, c.workspace_id,
       coalesce(c.created_by, (select m.user_id from public.memberships m where m.workspace_id = c.workspace_id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1)),
       'owner', now()
from public.campaigns c
where coalesce(c.created_by, (select m.user_id from public.memberships m where m.workspace_id = c.workspace_id and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1)) is not null
on conflict do nothing;
insert into public.campaign_members (campaign_id, workspace_id, user_id, role, last_seen_at)
select c.id, c.workspace_id, m.user_id, case when m.role = 'viewer' then 'viewer' else 'member' end, now()
from public.campaigns c join public.memberships m on m.workspace_id = c.workspace_id and m.status = 'active'
where c.created_at < '2026-10-02'
on conflict do nothing;
