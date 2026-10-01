-- =============================================================================
-- Radar en RELEVO: un solo registro de señales (Morning Brief, RADAR del Sheet migrado, capturas),
-- activos con historial de precios (observación ≠ conclusión: dos precios distintos = inconsistente)
-- y fuentes acumuladas por historia (fuente nueva ≠ historia nueva).
-- =============================================================================

-- Señales: no todas nacen en un brief (las del RADAR del Sheet, por ejemplo).
alter table public.brief_signals alter column brief_id drop not null;
alter table public.brief_signals
  add column origin text not null default 'brief' check (origin in ('brief', 'radar_sheet', 'captura')),
  add column external_ref text,
  add column validation_status text,
  add column next_action text,
  add column implication text;
create unique index brief_signals_external_ref_uq on public.brief_signals (workspace_id, external_ref) where external_ref is not null;
create policy brief_signals_insert on public.brief_signals for insert with check (public.can_edit(workspace_id));

-- Cada fuente que habla de una historia (la misma noticia en otro medio suma evidencia, no otra historia).
create table public.brief_story_sources (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  story_id     uuid not null,
  url          text not null check (url ~* '^https?://'),
  title        text,
  publisher    text,
  signal_id    uuid,
  first_seen_on date not null,
  unique (story_id, url),
  foreign key (workspace_id, story_id) references public.brief_stories (workspace_id, id) on delete cascade
);
alter table public.brief_story_sources enable row level security;
create policy brief_story_sources_select on public.brief_story_sources for select using (public.is_member(workspace_id));

-- Activos del Radar: lo que el RADAR del Sheet registra por activo.
alter table public.assets
  add column radar_ref text,
  add column category text,
  add column land_m2 numeric(14, 2) check (land_m2 is null or land_m2 > 0),
  add column capacity_text text,
  add column occupancy_declared text,
  add column owner_text text,
  add column broker_text text,
  add column operator_text text,
  add column sale_reason text,
  add column economics_note text,
  add column first_detected_on date,
  add column last_checked_on date,
  add column material_change text,
  add column evidence_layer text,
  add column price_status text check (price_status in ('vigente', 'inconsistente', 'sin_validar')),
  add column listing_status text not null default 'publicado' check (listing_status in ('publicado', 'retirado', 'reaparecido', 'sin_dato'));
create unique index assets_radar_ref_uq on public.assets (workspace_id, radar_ref) where radar_ref is not null;

-- Historial de precios: cada observación con su fuente y fecha. Nunca se pisa el anterior.
create table public.asset_prices (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  asset_id      uuid not null,
  amount        numeric(16, 2) not null check (amount >= 0),
  currency      text not null check (currency in ('ARS', 'USD')),
  operation     text not null default 'venta' check (operation in ('venta', 'alquiler')),
  period        text,
  observed_on   date,
  source_url    text check (source_url is null or source_url ~* '^https?://'),
  source_title  text,
  publisher     text,
  basis         text not null default 'publicado' check (basis in ('publicado', 'declarado', 'confirmado')),
  note          text,
  origin        text not null default 'radar_sheet' check (origin in ('radar_sheet', 'brief', 'captura', 'manual')),
  external_ref  text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade
);
create index asset_prices_asset_idx on public.asset_prices (asset_id, observed_on);
create unique index asset_prices_dedupe_uq on public.asset_prices (asset_id, amount, currency, coalesce(source_url, ''), coalesce(observed_on, '1900-01-01'));
alter table public.asset_prices enable row level security;
create policy asset_prices_select on public.asset_prices for select using (public.is_member(workspace_id));
create policy asset_prices_insert on public.asset_prices for insert with check (public.can_edit(workspace_id));
create trigger audit_asset_prices after insert on public.asset_prices for each row execute function public.audit_row();

-- Candidatos con datos estructurados (p. ej. un activo detectado: precio, superficie, fuente).
alter table public.brief_candidates add column payload jsonb not null default '{}';
