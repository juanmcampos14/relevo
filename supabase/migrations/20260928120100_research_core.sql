-- =============================================================================
-- 0002 · Núcleo de investigación (Corte A)
-- Campaign → Vertical → Entity/Asset → Source → Claim → Target → Visit plan → Visit
--
-- Reglas de integridad:
--  * Toda tabla tenant tiene workspace_id + unique (workspace_id, id) y las FK
--    son COMPUESTAS (workspace_id, x_id): imposible vincular registros de otro
--    workspace aunque se conozca su UUID (las FK ignoran RLS).
--  * Coordenadas solo con dirección verificada; precio publicado solo con
--    moneda + fecha + fuente; afirmación "confirmada" solo con fuente.
--  * is_demo marca explícitamente todo dato ficticio.
-- =============================================================================

-- Catálogo único de verificación (doc §3).
create or replace function public.is_verification_status(v text)
returns boolean language sql immutable as $$
  select v in ('confirmado', 'declarado_por_contacto', 'fuente_publica_sin_verificar', 'hipotesis', 'demo');
$$;

-- -----------------------------------------------------------------------------
-- Campañas y verticales
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  zone          text,
  objective     text,
  starts_on     date,
  ends_on       date,
  status        text not null default 'borrador' check (status in ('borrador', 'activa', 'pausada', 'finalizada')),
  owner_id      uuid references auth.users (id) on delete set null,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.verticals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  thesis          text,
  problem_sought  text,
  owner_id        uuid references auth.users (id) on delete set null,
  status          text not null default 'activa' check (status in ('activa', 'archivada')),
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, name)
);

create table public.campaign_verticals (
  workspace_id  uuid not null,
  campaign_id   uuid not null,
  vertical_id   uuid not null,
  created_at    timestamptz not null default now(),
  primary key (campaign_id, vertical_id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete cascade,
  foreign key (workspace_id, vertical_id) references public.verticals (workspace_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Fuentes y entidades canónicas
-- -----------------------------------------------------------------------------
create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  kind          text not null check (kind in ('url', 'documento', 'contacto', 'observacion', 'drive', 'research_externo')),
  title         text not null check (length(trim(title)) > 0),
  url           text check (url is null or url ~* '^https?://'),
  publisher     text,
  published_at  date,
  captured_at   timestamptz not null default now(),
  reference     text,
  notes         text,
  is_demo       boolean not null default false,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  check (kind not in ('url', 'research_externo', 'drive') or url is not null)
);
-- Deduplicación por URL dentro del workspace (ingesta idempotente futura).
create unique index sources_ws_url_uniq on public.sources (workspace_id, url) where url is not null;

create table public.companies (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  legal_name           text,
  trade_name           text,
  kind                 text not null default 'otro'
                        check (kind in ('operador', 'cliente_potencial', 'proveedor', 'socio_potencial', 'competidor', 'inversor_potencial', 'asesor', 'otro')),
  website              text check (website is null or website ~* '^https?://'),
  locality             text,
  verification_status  text not null default 'hipotesis' check (public.is_verification_status(verification_status)),
  source_id            uuid,
  notes                text,
  is_demo              boolean not null default false,
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, id),
  check (coalesce(trim(legal_name), '') <> '' or coalesce(trim(trade_name), '') <> ''),
  check (verification_status in ('hipotesis', 'demo') or source_id is not null),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id)
);

-- Ubicación reutilizable por establecimientos y assets.
-- address_status: sin_direccion | no_verificada | verificada.
create table public.establishments (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  company_id          uuid,
  name                text not null check (length(trim(name)) > 0),
  address_text        text,
  locality            text,
  province            text default 'Neuquén',
  country             text default 'Argentina',
  address_status      text not null default 'sin_direccion' check (address_status in ('sin_direccion', 'no_verificada', 'verificada')),
  latitude            double precision check (latitude between -90 and 90),
  longitude           double precision check (longitude between -180 and 180),
  location_source_id  uuid,
  location_verified_at timestamptz,
  verification_status text not null default 'hipotesis' check (public.is_verification_status(verification_status)),
  source_id           uuid,
  notes               text,
  is_demo             boolean not null default false,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  check ((address_status = 'sin_direccion') = (coalesce(trim(address_text), '') = '')),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or address_status = 'verificada'),
  check (address_status <> 'verificada' or location_source_id is not null),
  check (verification_status in ('hipotesis', 'demo') or source_id is not null),
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete set null (company_id),
  foreign key (workspace_id, location_source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id)
);

create table public.assets (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  kind                text not null check (kind in ('inmueble', 'terreno', 'local', 'fondo_de_comercio', 'otro')),
  operation           text not null default 'desconocida' check (operation in ('venta', 'alquiler', 'asociacion', 'desconocida')),
  title               text not null check (length(trim(title)) > 0),
  address_text        text,
  locality            text,
  province            text default 'Neuquén',
  country             text default 'Argentina',
  address_status      text not null default 'sin_direccion' check (address_status in ('sin_direccion', 'no_verificada', 'verificada')),
  latitude            double precision check (latitude between -90 and 90),
  longitude           double precision check (longitude between -180 and 180),
  location_source_id  uuid,
  location_verified_at timestamptz,
  surface_m2          numeric(14, 2) check (surface_m2 is null or surface_m2 > 0),
  price_amount        numeric(16, 2) check (price_amount is null or price_amount >= 0),
  price_currency      text check (price_currency in ('ARS', 'USD')),
  price_observed_on   date,
  price_source_id     uuid,
  owner_company_id    uuid,
  establishment_id    uuid,
  verification_status text not null default 'hipotesis' check (public.is_verification_status(verification_status)),
  source_id           uuid,
  notes               text,
  is_demo             boolean not null default false,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  check ((address_status = 'sin_direccion') = (coalesce(trim(address_text), '') = '')),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or address_status = 'verificada'),
  check (address_status <> 'verificada' or location_source_id is not null),
  -- Precio publicado: todo o nada, siempre con moneda, fecha y fuente.
  check ((price_amount is null and price_currency is null and price_observed_on is null and price_source_id is null)
      or (price_amount is not null and price_currency is not null and price_observed_on is not null and price_source_id is not null)),
  check (verification_status in ('hipotesis', 'demo') or source_id is not null),
  foreign key (workspace_id, location_source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, price_source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, owner_company_id) references public.companies (workspace_id, id) on delete set null (owner_company_id),
  foreign key (workspace_id, establishment_id) references public.establishments (workspace_id, id) on delete set null (establishment_id)
);

create table public.contacts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  full_name           text not null check (length(trim(full_name)) > 0),
  role_title          text,
  email               text check (email is null or position('@' in email) > 1),
  phone               text,
  preferred_channel   text check (preferred_channel in ('presencial', 'telefono', 'whatsapp', 'email', 'otro')),
  contact_permission  text not null default 'sin_definir'
                       check (contact_permission in ('sin_definir', 'permitido', 'solo_via_intro', 'no_contactar')),
  introduced_by       text,
  verification_status text not null default 'hipotesis' check (public.is_verification_status(verification_status)),
  source_id           uuid,
  notes               text,
  is_demo             boolean not null default false,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  check (verification_status in ('hipotesis', 'demo') or source_id is not null),
  -- Datos de contacto solo si fueron aportados legítimamente: exigen fuente.
  check ((email is null and phone is null) or source_id is not null),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id)
);

create table public.contact_links (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  contact_id        uuid not null,
  company_id        uuid,
  establishment_id  uuid,
  asset_id          uuid,
  relation          text not null default 'otro'
                     check (relation in ('dueno', 'encargado', 'empleado', 'referidor', 'comprador', 'vendedor', 'corredor', 'asesor', 'otro')),
  created_at        timestamptz not null default now(),
  check (num_nonnulls(company_id, establishment_id, asset_id) = 1),
  unique nulls not distinct (contact_id, company_id, establishment_id, asset_id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, establishment_id) references public.establishments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade
);

-- Afirmaciones con procedencia sobre cualquier entidad.
create table public.claims (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  company_id            uuid,
  establishment_id      uuid,
  asset_id              uuid,
  contact_id            uuid,
  statement             text not null check (length(trim(statement)) > 0),
  source_id             uuid,
  verification_status   text not null default 'hipotesis' check (public.is_verification_status(verification_status)),
  next_verification_step text,
  created_by            uuid references auth.users (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, id),
  check (num_nonnulls(company_id, establishment_id, asset_id, contact_id) = 1),
  check (verification_status in ('hipotesis', 'demo') or source_id is not null),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, establishment_id) references public.establishments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade,
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Targets: qué investigamos dentro de una campaña (relación, no entidad nueva)
-- -----------------------------------------------------------------------------
create table public.campaign_targets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  campaign_id       uuid not null,
  company_id        uuid,
  establishment_id  uuid,
  asset_id          uuid,
  status            text not null default 'identificado'
                     check (status in ('identificado', 'por_investigar', 'por_contactar', 'contactado',
                                       'visita_programada', 'visitado', 'seguimiento', 'descartado')),
  priority          smallint not null default 2 check (priority between 1 and 3),
  next_action       text,
  next_action_due   date,
  discard_reason    text,
  owner_id          uuid references auth.users (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  check (num_nonnulls(company_id, establishment_id, asset_id) = 1),
  unique nulls not distinct (campaign_id, company_id, establishment_id, asset_id),
  check (status <> 'descartado' or coalesce(trim(discard_reason), '') <> ''),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete cascade,
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, establishment_id) references public.establishments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade
);
create index campaign_targets_campaign_status_idx on public.campaign_targets (campaign_id, status);

create table public.target_verticals (
  workspace_id  uuid not null,
  target_id     uuid not null,
  vertical_id   uuid not null,
  primary key (target_id, vertical_id),
  foreign key (workspace_id, target_id) references public.campaign_targets (workspace_id, id) on delete cascade,
  foreign key (workspace_id, vertical_id) references public.verticals (workspace_id, id) on delete cascade
);
create index target_verticals_vertical_idx on public.target_verticals (vertical_id);

-- -----------------------------------------------------------------------------
-- Campo: jornadas, paradas y visitas
-- -----------------------------------------------------------------------------
create table public.visit_plans (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  campaign_id   uuid,
  title         text not null check (length(trim(title)) > 0),
  planned_on    date not null,
  owner_id      uuid references auth.users (id) on delete set null default auth.uid(),
  notes         text,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id)
);

create table public.visit_stops (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  plan_id       uuid not null,
  target_id     uuid not null,
  position      integer not null check (position >= 0),
  target_time   time,
  status        text not null default 'programada' check (status in ('programada', 'confirmada', 'realizada', 'no_realizada')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (plan_id, target_id),
  foreign key (workspace_id, plan_id) references public.visit_plans (workspace_id, id) on delete cascade,
  foreign key (workspace_id, target_id) references public.campaign_targets (workspace_id, id) on delete cascade
);
create index visit_stops_plan_idx on public.visit_stops (plan_id, position);

create table public.visits (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  target_id         uuid not null,
  stop_id           uuid,
  visited_at        timestamptz not null default now(),
  interlocutor_name text,
  contact_id        uuid,
  -- P0 no graba audio; el consentimiento se registra igual para la futura captura.
  consent_status    text not null default 'no_registrado'
                     check (consent_status in ('no_registrado', 'otorgado', 'denegado', 'no_aplica')),
  notes             text not null default '',
  is_demo           boolean not null default false,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, target_id) references public.campaign_targets (workspace_id, id) on delete cascade,
  foreign key (workspace_id, stop_id) references public.visit_stops (workspace_id, id) on delete set null (stop_id),
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id)
);
create index visits_target_idx on public.visits (target_id, visited_at desc);

-- -----------------------------------------------------------------------------
-- updated_at, RLS y auditoría en bloque
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  with_updated text[] := array['campaigns', 'verticals', 'sources', 'companies', 'establishments', 'assets',
                               'contacts', 'claims', 'campaign_targets', 'visit_plans', 'visit_stops', 'visits'];
  tenant text[] := with_updated || array['campaign_verticals', 'contact_links', 'target_verticals'];
begin
  foreach t in array with_updated loop
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s
                    for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array tenant loop
    execute format('alter table public.%I enable row level security', t);
    -- Acceso completo por defecto para todo miembro (incluido viewer: solo lectura).
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_member(workspace_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t);
    -- Borrado físico reservado a owner/admin; el resto descarta/archiva.
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.has_role(workspace_id, array[''owner'', ''admin'']))', t);
    execute format('create index if not exists %1$s_workspace_idx on public.%1$s (workspace_id)', t);
  end loop;

  foreach t in array with_updated loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
  end loop;
end $$;
