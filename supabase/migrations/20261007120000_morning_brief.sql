-- =============================================================================
-- Morning Brief V1: un parte diario por workspace (brief_id), generado por RELEVO.
-- fuentes → señales estructuradas → brief (memoria) → email (una salida más).
-- Lo escribe el servidor (cron, cliente de servicio); el equipo lo lee y decide candidatos.
-- =============================================================================

create table public.briefs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  brief_date       date not null,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  version          text not null,
  -- recolectando → investigando → sintetizando → generado | fallido (cada paso reintentable)
  status           text not null default 'recolectando'
                    check (status in ('recolectando', 'investigando', 'sintetizando', 'generado', 'fallido')),
  step_started_at  timestamptz,
  attempts         integer not null default 0,
  collected        jsonb not null default '[]',
  research         jsonb not null default '{}',
  content          jsonb not null default '{}',
  engines          jsonb not null default '{}',
  usage            jsonb not null default '{}',
  error            text,
  generated_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, brief_date)
);

-- Historias vivas: la misma historia a lo largo de los días (inversión → contratista → proveedores…).
-- status watchlist = se sigue observando sin acción; tiene memoria, no reinicia cada mañana.
create table public.brief_stories (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  title          text not null check (length(trim(title)) > 0),
  summary        text,
  status         text not null default 'activa' check (status in ('activa', 'watchlist', 'cerrada')),
  watch_reason   text,
  vertical       text,
  first_seen_on  date not null,
  last_seen_on   date not null,
  last_brief_id  uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, last_brief_id) references public.briefs (workspace_id, id) on delete set null (last_brief_id)
);

create table public.brief_signals (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  brief_id       uuid not null,
  story_id       uuid,
  position       integer not null default 0,
  headline       text not null check (length(trim(headline)) > 0),
  summary        text,
  happened_on    date,
  source_url     text check (source_url is null or source_url ~* '^https?://'),
  source_title   text,
  publisher      text,
  basis          text not null check (basis in ('hecho', 'declaracion', 'inferencia')),
  signal_type    text not null,
  section        text not null check (section in ('general', 'anelo', 'empresas', 'activos')),
  geography      text,
  vertical       text,
  subsector      text,
  roles          text[] not null default '{}',
  companies      text[] not null default '{}',
  people         text[] not null default '{}',
  why_it_matters text,
  reading        text,
  change         text not null check (change in ('nuevo', 'actualizado', 'confirmado', 'contradicho', 'descartado')),
  relevance      text not null check (relevance in ('alta', 'media', 'baja')),
  -- Cruces con la memoria (verificados al guardar; sin FK porque son listas).
  company_ids    uuid[] not null default '{}',
  finding_ids    uuid[] not null default '{}',
  campaign_ids   uuid[] not null default '{}',
  asset_ids      uuid[] not null default '{}',
  suggested_action text,
  status         text not null default 'nueva' check (status in ('nueva', 'seguida', 'descartada', 'incorporada')),
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, brief_id) references public.briefs (workspace_id, id) on delete cascade,
  foreign key (workspace_id, story_id) references public.brief_stories (workspace_id, id) on delete set null (story_id)
);
create index brief_signals_brief_idx on public.brief_signals (brief_id, position);
create index brief_signals_story_idx on public.brief_signals (story_id);

-- Notas ya consideradas: una misma URL no vuelve a entrar como nueva.
create table public.brief_source_items (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  url             text not null check (url ~* '^https?://'),
  title           text,
  publisher       text,
  published_at    timestamptz,
  first_brief_id  uuid,
  seen_at         timestamptz not null default now(),
  unique (workspace_id, url),
  foreign key (workspace_id, first_brief_id) references public.briefs (workspace_id, id) on delete set null (first_brief_id)
);

-- detectado → candidato → aprobado → incorporado (nunca alta automática en el CRM).
create table public.brief_candidates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brief_id     uuid not null,
  kind         text not null check (kind in ('empresa', 'persona', 'activo', 'fuente', 'relacion')),
  name         text not null check (length(trim(name)) > 0),
  detail       text,
  source_url   text check (source_url is null or source_url ~* '^https?://'),
  status       text not null default 'candidato' check (status in ('candidato', 'aprobado', 'descartado', 'incorporado')),
  entity_ref   text,
  decided_by   uuid references auth.users (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, brief_id) references public.briefs (workspace_id, id) on delete cascade
);
create index brief_candidates_open_idx on public.brief_candidates (workspace_id, status);

-- Un envío por destinatario y brief: se reintenta sin repetir el research.
create table public.brief_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  brief_id            uuid not null,
  recipient_email     text not null check (position('@' in recipient_email) > 1),
  recipient_name      text,
  provider            text,
  status              text not null default 'pendiente' check (status in ('pendiente', 'enviado', 'fallido')),
  provider_message_id text,
  error               text,
  attempts            integer not null default 0,
  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique (brief_id, recipient_email),
  foreign key (workspace_id, brief_id) references public.briefs (workspace_id, id) on delete cascade
);

alter table public.briefs enable row level security;
alter table public.brief_stories enable row level security;
alter table public.brief_signals enable row level security;
alter table public.brief_source_items enable row level security;
alter table public.brief_candidates enable row level security;
alter table public.brief_deliveries enable row level security;

create policy briefs_select on public.briefs for select using (public.is_member(workspace_id));
create policy brief_stories_select on public.brief_stories for select using (public.is_member(workspace_id));
create policy brief_stories_update on public.brief_stories for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy brief_signals_select on public.brief_signals for select using (public.is_member(workspace_id));
create policy brief_signals_update on public.brief_signals for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy brief_source_items_select on public.brief_source_items for select using (public.is_member(workspace_id));
create policy brief_candidates_select on public.brief_candidates for select using (public.is_member(workspace_id));
create policy brief_candidates_update on public.brief_candidates for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy brief_deliveries_select on public.brief_deliveries for select using (public.is_member(workspace_id));

create trigger audit_brief_candidates after insert or update on public.brief_candidates
  for each row execute function public.audit_row();
create trigger audit_brief_stories after insert or update on public.brief_stories
  for each row execute function public.audit_row();
create trigger audit_brief_deliveries after insert or update on public.brief_deliveries
  for each row execute function public.audit_row();
