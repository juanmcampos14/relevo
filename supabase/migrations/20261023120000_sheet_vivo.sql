-- El Sheet operativo como fuente viva: RELEVO detecta qué cambió desde la última vez (fila nueva, fila
-- modificada, sin cambios) y procesa solo eso con la reconciliación. El Sheet es una fuente, no la verdad.

-- Huella de cada fila vista (por pestaña e ID): si no cambió, no se vuelve a procesar.
create table public.sheet_rows (
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  sheet_id           text not null,
  tab                text not null,
  external_id        text not null,
  row_hash           text not null,
  row_number         integer,
  values             jsonb not null default '{}',
  first_seen_at      timestamptz not null default now(),
  last_changed_at    timestamptz not null default now(),
  last_processed_at  timestamptz,
  last_batch_id      uuid,
  primary key (workspace_id, sheet_id, tab, external_id)
);
alter table public.sheet_rows enable row level security;
create policy sheet_rows_select on public.sheet_rows for select using (public.is_member(workspace_id));

-- Cada sincronización: cuándo, qué versión del Sheet, qué cambió y qué hizo RELEVO.
create table public.sheet_syncs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  sheet_id         text not null,
  trigger          text not null check (trigger in ('cron', 'manual', 'prueba')),
  sheet_modified_at timestamptz,
  status           text not null check (status in ('sin_cambios', 'procesado', 'error')),
  changed          jsonb not null default '{}',
  result           jsonb not null default '{}',
  batch_ids        uuid[] not null default '{}',
  error            text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index sheet_syncs_recent on public.sheet_syncs (workspace_id, started_at desc);
alter table public.sheet_syncs enable row level security;
create policy sheet_syncs_select on public.sheet_syncs for select using (public.is_member(workspace_id));
