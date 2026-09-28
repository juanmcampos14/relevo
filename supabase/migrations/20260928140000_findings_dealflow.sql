-- =============================================================================
-- 0003 · Corte B: Research → Finding → Verificación → Revisión humana →
--        Opportunity candidata → Aprobación (decision) → Dealflow
--
-- Reglas duras (en la base, no solo en la UI):
--  * Todo finding tiene fuente. Revisarlo registra quién y cuándo (trigger).
--  * Un finding revisado no se edita: hay que volverlo a "pendiente" primero.
--  * Una oportunidad nace SIEMPRE como candidata y solo desde findings aprobados.
--  * Salir de "candidata" exige can_approve_decisions y una decisión registrada;
--    solo las aprobadas tienen etapa de dealflow.
--  * Decidir (aprobar/rechazar/diferir) exige can_approve_decisions.
--  * Altas con idempotency_key: el doble clic o el reintento no duplica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Findings
-- -----------------------------------------------------------------------------
create table public.findings (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  source_id            uuid not null,
  visit_id             uuid,
  campaign_id          uuid,
  vertical_id          uuid,
  company_id           uuid,
  establishment_id     uuid,
  asset_id             uuid,
  kind                 text not null check (kind in ('hecho_declarado', 'observacion', 'necesidad', 'riesgo', 'pregunta',
                                                     'senal_de_mercado', 'oferta_publicada', 'accion_propuesta')),
  statement            text not null check (length(trim(statement)) > 0),
  evidence             text,
  analysis             text,
  origin               text not null default 'manual' check (origin in ('manual', 'research_externo', 'ia')),
  verification_status  text not null default 'hipotesis' check (public.is_verification_status(verification_status)),
  review_status        text not null default 'pendiente_revision' check (review_status in ('pendiente_revision', 'aprobado', 'rechazado')),
  review_note          text,
  reviewed_by          uuid references auth.users (id) on delete set null,
  reviewed_at          timestamptz,
  -- Ingesta idempotente (Morning Brief, P1) y alta manual sin duplicados.
  dedup_key            text,
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, dedup_key),
  check (num_nonnulls(company_id, establishment_id, asset_id) <= 1),
  check ((review_status = 'pendiente_revision') = (reviewed_at is null)),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, visit_id) references public.visits (workspace_id, id) on delete set null (visit_id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id),
  foreign key (workspace_id, vertical_id) references public.verticals (workspace_id, id) on delete set null (vertical_id),
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, establishment_id) references public.establishments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade
);
create index findings_review_idx on public.findings (workspace_id, review_status, created_at desc);
create index findings_visit_idx on public.findings (visit_id);

create or replace function public.findings_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.review_status <> 'pendiente_revision' and new.review_status = old.review_status
       and (new.statement, new.evidence, new.kind, new.source_id)
           is distinct from (old.statement, old.evidence, old.kind, old.source_id) then
      raise exception 'finding revisado: volvelo a pendiente antes de editar su contenido';
    end if;
    if new.review_status is distinct from old.review_status then
      if new.review_status = 'pendiente_revision' then
        new.reviewed_by := null;
        new.reviewed_at := null;
      else
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      end if;
    end if;
  elsif tg_op = 'INSERT' and new.review_status <> 'pendiente_revision' then
    raise exception 'un finding nace pendiente de revisión';
  end if;
  return new;
end $$;
create trigger findings_guard before insert or update on public.findings
  for each row execute function public.findings_guard();

-- -----------------------------------------------------------------------------
-- Opportunities
-- -----------------------------------------------------------------------------
create or replace function public.is_dealflow_stage(v text)
returns boolean language sql immutable as $$
  select v in ('contacto_identificado', 'primer_contacto', 'entrevista_visita', 'en_validacion', 'pre_diligencia',
               'diligencia', 'propuesta_negociacion', 'piloto_acuerdo', 'operacion', 'pausada', 'descartada');
$$;

create table public.opportunities (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  title             text not null check (length(trim(title)) > 0),
  thesis            text,
  route             text not null default 'a_definir'
                     check (route in ('adquisicion', 'participacion', 'gestion', 'alianza', 'creacion_propia', 'a_definir')),
  status            text not null default 'candidata' check (status in ('candidata', 'aprobada', 'rechazada')),
  stage             text check (stage is null or public.is_dealflow_stage(stage)),
  stage_reason      text,
  next_action       text,
  next_action_due   date,
  owner_id          uuid references auth.users (id) on delete set null default auth.uid(),
  campaign_id       uuid,
  idempotency_key   text,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  check ((status = 'aprobada') = (stage is not null)),
  check (stage not in ('pausada', 'descartada') or coalesce(trim(stage_reason), '') <> ''),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id)
);
create index opportunities_status_idx on public.opportunities (workspace_id, status, stage);

create table public.opportunity_findings (
  workspace_id    uuid not null,
  opportunity_id  uuid not null,
  finding_id      uuid not null,
  created_at      timestamptz not null default now(),
  primary key (opportunity_id, finding_id),
  foreign key (workspace_id, opportunity_id) references public.opportunities (workspace_id, id) on delete cascade,
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade
);

create or replace function public.opportunity_findings_guard()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.findings f where f.id = new.finding_id and f.review_status = 'aprobado') then
    raise exception 'solo se vinculan findings aprobados por revisión humana';
  end if;
  return new;
end $$;
create trigger opportunity_findings_guard before insert on public.opportunity_findings
  for each row execute function public.opportunity_findings_guard();

-- -----------------------------------------------------------------------------
-- Decisiones
-- -----------------------------------------------------------------------------
create table public.decisions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  opportunity_id  uuid,
  kind            text not null default 'general' check (kind in ('general', 'aprobar_oportunidad')),
  question        text not null check (length(trim(question)) > 0),
  context         text,
  due_on          date,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'deferred')),
  decision_note   text,
  requested_by    uuid references auth.users (id) on delete set null default auth.uid(),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  check ((status = 'requested') = (decided_at is null)),
  check (kind <> 'aprobar_oportunidad' or opportunity_id is not null),
  foreign key (workspace_id, opportunity_id) references public.opportunities (workspace_id, id) on delete cascade
);
-- Una sola solicitud de aprobación abierta por oportunidad.
create unique index decisions_one_open_approval
  on public.decisions (opportunity_id) where kind = 'aprobar_oportunidad' and status = 'requested';

create or replace function public.decisions_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.status <> 'requested' then
    raise exception 'una decisión nace como solicitud';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status <> 'requested' and old.status <> 'deferred' then
      raise exception 'la decisión ya fue tomada';
    end if;
    if new.status <> 'requested' and not public.can_approve(new.workspace_id) then
      raise exception 'se requiere la capacidad can_approve_decisions' using errcode = '42501';
    end if;
    new.decided_by := case when new.status = 'requested' then null else auth.uid() end;
    new.decided_at := case when new.status = 'requested' then null else now() end;
  end if;
  return new;
end $$;
create trigger decisions_guard before insert or update on public.decisions
  for each row execute function public.decisions_guard();

-- Cambios de estado de la oportunidad: solo mediante una decisión aprobada/rechazada.
create or replace function public.opportunities_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'candidata' then
      raise exception 'una oportunidad nace como candidata';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'candidata' then
      raise exception 'el estado de la oportunidad ya fue decidido';
    end if;
    if not public.can_approve(new.workspace_id) then
      raise exception 'se requiere la capacidad can_approve_decisions' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.decisions d
      where d.opportunity_id = new.id and d.kind = 'aprobar_oportunidad'
        and d.status = case new.status when 'aprobada' then 'approved' else 'rejected' end
    ) then
      raise exception 'falta la decisión registrada';
    end if;
    if new.status = 'aprobada' and not exists (
      select 1 from public.opportunity_findings o join public.findings f on f.id = o.finding_id
      where o.opportunity_id = new.id and f.review_status = 'aprobado'
    ) then
      raise exception 'una oportunidad aprobada necesita al menos un finding aprobado';
    end if;
  end if;
  return new;
end $$;
create trigger opportunities_guard before insert or update on public.opportunities
  for each row execute function public.opportunities_guard();

-- Decisión de aprobación atómica: registra la decisión y mueve la oportunidad.
-- security invoker: RLS y triggers aplican con los permisos de quien decide.
create or replace function public.decide_opportunity(p_decision uuid, p_verdict text, p_note text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  d public.decisions;
begin
  if p_verdict not in ('approved', 'rejected', 'deferred') then
    raise exception 'veredicto inválido';
  end if;
  select * into d from public.decisions where id = p_decision for update;
  if not found or d.kind <> 'aprobar_oportunidad' then
    raise exception 'decisión no encontrada';
  end if;
  update public.decisions set status = p_verdict, decision_note = p_note where id = p_decision;
  if p_verdict = 'approved' then
    update public.opportunities set status = 'aprobada', stage = 'contacto_identificado' where id = d.opportunity_id;
  elsif p_verdict = 'rejected' then
    update public.opportunities set status = 'rechazada' where id = d.opportunity_id;
  end if;
end $$;
revoke execute on function public.decide_opportunity(uuid, text, text) from public, anon;
grant execute on function public.decide_opportunity(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Tareas, comentarios y briefings
-- -----------------------------------------------------------------------------
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  description      text,
  status           text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  assignee_id      uuid references auth.users (id) on delete set null,
  due_on           date,
  finding_id       uuid,
  opportunity_id   uuid,
  target_id        uuid,
  completed_at     timestamptz,
  idempotency_key  text,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete set null (finding_id),
  foreign key (workspace_id, opportunity_id) references public.opportunities (workspace_id, id) on delete set null (opportunity_id),
  foreign key (workspace_id, target_id) references public.campaign_targets (workspace_id, id) on delete set null (target_id)
);
create index tasks_assignee_idx on public.tasks (workspace_id, assignee_id, status);

create or replace function public.tasks_completed_at()
returns trigger language plpgsql as $$
begin
  new.completed_at := case when new.status = 'done' then coalesce(old.completed_at, now()) else null end;
  return new;
end $$;
create trigger tasks_completed_at before insert or update on public.tasks
  for each row execute function public.tasks_completed_at();

create table public.briefings (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  scope             text not null check (scope in ('conjunto', 'personal')),
  audience_user_id  uuid references auth.users (id) on delete set null,
  title             text not null,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  content           jsonb not null,
  status            text not null default 'borrador' check (status in ('borrador', 'publicado_en_app')),
  published_at      timestamptz,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  check (period_end > period_start),
  check ((scope = 'personal') = (audience_user_id is not null)),
  check ((status = 'publicado_en_app') = (published_at is not null))
);

create table public.comments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  decision_id     uuid,
  opportunity_id  uuid,
  finding_id      uuid,
  briefing_id     uuid,
  body            text not null check (length(trim(body)) > 0),
  author_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  check (num_nonnulls(decision_id, opportunity_id, finding_id, briefing_id) = 1),
  foreign key (workspace_id, decision_id) references public.decisions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, opportunity_id) references public.opportunities (workspace_id, id) on delete cascade,
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade,
  foreign key (workspace_id, briefing_id) references public.briefings (workspace_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- updated_at, RLS y auditoría
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  with_updated text[] := array['findings', 'opportunities', 'decisions', 'tasks', 'briefings'];
  tenant text[] := with_updated || array['opportunity_findings', 'comments'];
begin
  foreach t in array with_updated loop
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array tenant loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_member(workspace_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.has_role(workspace_id, array[''owner'', ''admin'']))', t);
    execute format('create index if not exists %1$s_workspace_idx on public.%1$s (workspace_id)', t);
  end loop;
  foreach t in array with_updated || array['comments'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- Comentarios: cada uno edita/borra solo los suyos (los viewers también pueden comentar).
drop policy comments_insert on public.comments;
drop policy comments_update on public.comments;
drop policy comments_delete on public.comments;
create policy comments_insert on public.comments for insert
  with check (public.is_member(workspace_id) and author_id = auth.uid());
create policy comments_update on public.comments for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete using (author_id = auth.uid());

-- Decisiones: un viewer puede ver pero no pedir ni decidir; decidir lo valida el trigger.
