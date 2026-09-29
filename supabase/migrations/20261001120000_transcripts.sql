-- =============================================================================
-- 0012 · Transcripción de audio (entrada al mismo pipeline de capturas)
-- Audio original (storage) → transcripción (esta tabla) → procesamiento → propuestas.
-- El audio y su transcripción se conservan; la evidencia puede apuntar al segundo exacto.
-- =============================================================================

create table public.transcripts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  capture_id       uuid not null,
  capture_media_id uuid not null unique,
  provider         text not null,
  model            text not null,
  language         text,
  status           text not null check (status in ('ok', 'error')),
  text             text,
  -- Segmentos con tiempo: [{start_ms, end_ms, text}]
  utterances       jsonb not null default '[]',
  duration_ms      integer,
  error            text,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  check (status <> 'ok' or text is not null),
  check (status <> 'error' or coalesce(trim(error), '') <> ''),
  foreign key (workspace_id, capture_id) references public.captures (workspace_id, id) on delete cascade,
  foreign key (workspace_id, capture_media_id) references public.capture_media (workspace_id, id) on delete cascade
);
create index transcripts_capture_idx on public.transcripts (capture_id);

alter table public.transcripts enable row level security;
create policy transcripts_select on public.transcripts for select using (public.is_member(workspace_id));
create policy transcripts_insert on public.transcripts for insert with check (public.can_edit(workspace_id));
create policy transcripts_update on public.transcripts for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create trigger audit_transcripts after insert or update or delete on public.transcripts
  for each row execute function public.audit_row();
