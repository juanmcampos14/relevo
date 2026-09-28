-- =============================================================================
-- 0004 · P1: RELEVO AI (conversaciones, ejecuciones, borradores de acción) e
--        ingesta del Morning Brief (tokens por workspace → findings pendientes).
--
-- Reglas:
--  * La IA solo LEE con los permisos del usuario (RLS) y PROPONE borradores.
--    Ningún borrador escribe en tablas de negocio: lo ejecuta un humano.
--  * Cada ejecución registra modelo, versión de prompt, tokens, costo y error.
--  * La ingesta crea findings "pendiente_revision" con dedup_key; nunca oportunidades.
--  * Los tokens de ingesta se guardan hasheados; el valor se muestra una sola vez.
-- =============================================================================

create table public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title         text not null default 'Conversación',
  scope         jsonb not null default '{"type":"workspace"}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id)
);
create index ai_conversations_user_idx on public.ai_conversations (workspace_id, user_id, updated_at desc);

create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  conversation_id  uuid not null,
  role             text not null check (role in ('user', 'assistant')),
  -- Texto para mostrar (con marcadores [[tipo:uuid]] ya validados).
  text             text not null default '',
  -- Bloques completos de la API para continuar la conversación con fidelidad.
  api_content      jsonb,
  citations        jsonb not null default '[]'::jsonb,
  run_id           uuid,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, conversation_id) references public.ai_conversations (workspace_id, id) on delete cascade
);
create index ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);

create table public.ai_runs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  user_id             uuid references auth.users (id) on delete set null default auth.uid(),
  conversation_id     uuid,
  model               text not null,
  prompt_version      text not null,
  status              text not null check (status in ('ok', 'error', 'refused', 'limit')),
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  tool_calls          integer not null default 0,
  cost_usd            numeric(10, 5) not null default 0,
  error               text,
  duration_ms         integer,
  created_at          timestamptz not null default now(),
  foreign key (workspace_id, conversation_id) references public.ai_conversations (workspace_id, id) on delete set null (conversation_id)
);
create index ai_runs_user_day_idx on public.ai_runs (workspace_id, user_id, created_at desc);

create table public.ai_action_drafts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  conversation_id  uuid not null,
  message_id       uuid,
  action           text not null check (action in ('create_task', 'draft_finding', 'request_decision')),
  payload          jsonb not null,
  rationale        text,
  evidence_refs    jsonb not null default '[]'::jsonb,
  status           text not null default 'propuesta' check (status in ('propuesta', 'aprobada', 'rechazada', 'ejecutada', 'error')),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  result_ref       text,
  error            text,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, conversation_id) references public.ai_conversations (workspace_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- Ingesta (Morning Brief u otras fuentes automáticas)
-- -----------------------------------------------------------------------------
create table public.ingest_tokens (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  token_hash    text not null unique,
  token_hint    text not null,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  unique (workspace_id, id)
);

alter table public.findings add column ingest_token_id uuid;
alter table public.findings add column ingest_meta jsonb;
alter table public.findings
  add constraint findings_ingest_token_fk foreign key (workspace_id, ingest_token_id)
  references public.ingest_tokens (workspace_id, id) on delete set null (ingest_token_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_action_drafts enable row level security;
alter table public.ingest_tokens enable row level security;

-- Conversaciones: visibles para todo el workspace (trazabilidad compartida);
-- solo su autor escribe en ellas.
create policy ai_conversations_select on public.ai_conversations for select using (public.is_member(workspace_id));
create policy ai_conversations_insert on public.ai_conversations for insert
  with check (public.is_member(workspace_id) and user_id = auth.uid());
create policy ai_conversations_update on public.ai_conversations for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_conversations_delete on public.ai_conversations for delete using (user_id = auth.uid());

create or replace function public.owns_conversation(conv uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.ai_conversations c where c.id = conv and c.user_id = auth.uid());
$$;
revoke execute on function public.owns_conversation(uuid) from public, anon;
grant execute on function public.owns_conversation(uuid) to authenticated;

create policy ai_messages_select on public.ai_messages for select using (public.is_member(workspace_id));
create policy ai_messages_insert on public.ai_messages for insert
  with check (public.is_member(workspace_id) and public.owns_conversation(conversation_id));

create policy ai_runs_select on public.ai_runs for select using (public.is_member(workspace_id));
create policy ai_runs_insert on public.ai_runs for insert
  with check (public.is_member(workspace_id) and user_id = auth.uid());

create policy ai_action_drafts_select on public.ai_action_drafts for select using (public.is_member(workspace_id));
create policy ai_action_drafts_insert on public.ai_action_drafts for insert
  with check (public.is_member(workspace_id) and public.owns_conversation(conversation_id) and status = 'propuesta');
-- Decidir un borrador requiere poder editar el workspace (el viewer no ejecuta nada).
create policy ai_action_drafts_update on public.ai_action_drafts for update
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));

create policy ingest_tokens_select on public.ingest_tokens for select using (public.has_role(workspace_id, array['owner', 'admin']));
create policy ingest_tokens_insert on public.ingest_tokens for insert
  with check (public.has_role(workspace_id, array['owner', 'admin']) and created_by = auth.uid());
create policy ingest_tokens_update on public.ingest_tokens for update
  using (public.has_role(workspace_id, array['owner', 'admin'])) with check (public.has_role(workspace_id, array['owner', 'admin']));

create trigger ai_conversations_set_updated_at before update on public.ai_conversations
  for each row execute function public.set_updated_at();
create trigger audit_ai_action_drafts after insert or update on public.ai_action_drafts
  for each row execute function public.audit_row();
create trigger audit_ingest_tokens after insert or update on public.ingest_tokens
  for each row execute function public.audit_row();
