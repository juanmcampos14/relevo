-- =============================================================================
-- 0011 · Propuestas de IA a partir de capturas (incremento C)
-- IA propone → humano promueve (docs/04-modelo-canonico.md §2). Una propuesta nunca
-- escribe en RELEVO por sí sola: queda "propuesta" hasta que alguien la acepta, la edita
-- o la rechaza. Siempre apunta a su captura y al fragmento que la sostiene.
-- =============================================================================

create table public.proposals (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  capture_id     uuid not null,
  kind           text not null check (kind in ('company', 'person', 'evidence', 'finding', 'next_action')),
  position       integer not null,
  payload        jsonb not null,
  -- Fragmento textual de la captura que sostiene la propuesta.
  quote          text,
  -- Entidades existentes que podrían ser la misma (para no duplicar): [{type, id, name, reason}].
  matches        jsonb not null default '[]',
  status         text not null default 'propuesta' check (status in ('propuesta', 'aceptada', 'editada', 'rechazada')),
  final_payload  jsonb,
  result_type    text check (result_type is null or result_type in ('company', 'contact', 'evidence', 'finding', 'task')),
  result_id      uuid,
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  ai_run_id      uuid references public.ai_runs (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  unique (capture_id, position),
  check ((status = 'propuesta') = (decided_at is null)),
  check (status not in ('aceptada', 'editada') or result_id is not null),
  foreign key (workspace_id, capture_id) references public.captures (workspace_id, id) on delete cascade
);
create index proposals_capture_idx on public.proposals (capture_id, position);
create index proposals_pending_idx on public.proposals (workspace_id) where status = 'propuesta';
create index proposals_result_idx on public.proposals (result_type, result_id) where result_id is not null;

alter table public.proposals enable row level security;
create policy proposals_select on public.proposals for select using (public.is_member(workspace_id));
create policy proposals_insert on public.proposals for insert with check (public.can_edit(workspace_id));
create policy proposals_update on public.proposals for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy proposals_delete on public.proposals for delete using (public.can_edit(workspace_id) and status = 'propuesta');
create trigger audit_proposals after insert or update or delete on public.proposals
  for each row execute function public.audit_row();

-- Resultado del procesamiento en la captura: resumen y corrida de IA.
alter table public.captures
  add column ai_summary   text,
  add column processed_at timestamptz,
  add column ai_run_id    uuid references public.ai_runs (id) on delete set null;

-- Los findings exigen fuente: una captura aceptada como origen se registra como fuente "observación".
alter table public.captures add column source_id uuid;
alter table public.captures add constraint captures_source_fk foreign key (workspace_id, source_id) references public.sources (workspace_id, id) on delete set null (source_id);
