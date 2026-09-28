-- =============================================================================
-- 0005 · Noticias (radar de mercado): notas externas por workspace y tema.
-- Una nota se guarda una sola vez por workspace (dedup por proveedor + id externo).
-- Una noticia NO es un hallazgo: se "pasa a hallazgo" a mano y entra pendiente de revisión.
-- =============================================================================

create table public.news_articles (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  topic          text not null,
  provider       text not null,
  external_id    text not null,
  url            text not null check (url ~* '^https?://'),
  title          text not null,
  source_name    text,
  source_url     text,
  snippet        text,
  published_at   timestamptz,
  fetched_at     timestamptz not null default now(),
  finding_id     uuid,
  unique (workspace_id, id),
  unique (workspace_id, provider, external_id),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete set null (finding_id)
);
create index news_articles_recent_idx on public.news_articles (workspace_id, topic, published_at desc nulls last);

create table public.news_fetch_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  topic         text not null,
  provider      text not null,
  status        text not null check (status in ('ok', 'error')),
  received      integer not null default 0,
  created       integer not null default 0,
  error         text,
  created_at    timestamptz not null default now()
);
create index news_fetch_runs_recent_idx on public.news_fetch_runs (workspace_id, topic, created_at desc);

alter table public.news_articles enable row level security;
alter table public.news_fetch_runs enable row level security;

-- Todo el workspace lee el radar. Las escrituras las hace el servidor (actualización)
-- o un editor (vincular el hallazgo creado desde la nota).
create policy news_articles_select on public.news_articles for select using (public.is_member(workspace_id));
create policy news_articles_insert on public.news_articles for insert with check (public.can_edit(workspace_id));
create policy news_articles_update on public.news_articles for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy news_fetch_runs_select on public.news_fetch_runs for select using (public.is_member(workspace_id));
create policy news_fetch_runs_insert on public.news_fetch_runs for insert with check (public.can_edit(workspace_id));
