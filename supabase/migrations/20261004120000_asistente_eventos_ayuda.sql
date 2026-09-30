-- =============================================================================
-- 0017 · Conversación como evento único, asistente con vista previa y auditoría, estado del caso y
--        pedidos de ayuda
-- - Una conversación (captura) es UN evento de evidencia: si se vuelve a subir el mismo audio o un
--   texto prácticamente idéntico, se detecta y no cuenta como fuente nueva.
-- - Las acciones del asistente son propuestas con vista previa (qué cambia, por qué, evidencia, riesgo
--   de duplicado) y guardan el estado anterior y posterior al ejecutarse con aprobación humana.
-- - Un caso puede pausarse, cerrarse o descartarse (y volver), siempre con motivo e historia.
-- - Un pedido de ayuda es concreto: a quién, qué, para qué caso, hasta cuándo, estado y resultado.
-- =============================================================================

-- Evento de evidencia: huella del contenido y duplicados.
alter table public.captures drop constraint captures_status_check;
alter table public.captures add constraint captures_status_check
  check (status in ('guardado', 'procesando', 'transcripto', 'propuestas_listas', 'revisado', 'error', 'duplicado'));
alter table public.captures
  add column content_hash  text,
  add column duplicate_of  uuid,
  add constraint captures_duplicate_fk foreign key (workspace_id, duplicate_of) references public.captures (workspace_id, id) on delete set null (duplicate_of),
  add constraint captures_duplicate_self check (duplicate_of is distinct from id);
create index captures_content_hash_idx on public.captures (workspace_id, content_hash) where content_hash is not null;
alter table public.capture_media add column sha256 text;
create index capture_media_sha256_idx on public.capture_media (workspace_id, sha256) where sha256 is not null;

-- Acciones del asistente: más tipos, vista previa y estado antes/después.
alter table public.ai_action_drafts drop constraint ai_action_drafts_action_check;
alter table public.ai_action_drafts add constraint ai_action_drafts_action_check
  check (action in ('create_task', 'draft_finding', 'request_decision', 'link_evidence', 'update_next_action', 'request_help', 'prepare_validation'));
alter table public.ai_action_drafts
  add column preview      jsonb not null default '{}',
  add column before_state jsonb,
  add column after_state  jsonb;

-- Estado del caso (independiente de la madurez): activo, pausado, cerrado o descartado.
alter table public.findings
  add column case_status text not null default 'activo' check (case_status in ('activo', 'pausado', 'cerrado', 'descartado'));
alter table public.finding_revisions drop constraint finding_revisions_kind_check;
alter table public.finding_revisions add constraint finding_revisions_kind_check check (kind in ('enunciado', 'madurez', 'estado'));

-- Pedidos de ayuda.
create table public.help_requests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  finding_id     uuid,
  requested_by   uuid references auth.users (id) on delete set null default auth.uid(),
  assignee_id    uuid not null references auth.users (id) on delete cascade,
  kind           text not null check (kind in ('contacto', 'introduccion', 'acceso', 'validacion', 'aprobacion', 'capital', 'conocimiento')),
  ask            text not null check (length(trim(ask)) > 0),
  target         text,
  due_on         date,
  status         text not null default 'abierto' check (status in ('abierto', 'en_curso', 'resuelto', 'cancelado')),
  result         text,
  evidence_id    uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id) references public.evidence (workspace_id, id) on delete set null (evidence_id),
  check (status <> 'resuelto' or coalesce(trim(result), '') <> '')
);
create index help_requests_open_idx on public.help_requests (workspace_id, assignee_id) where status in ('abierto', 'en_curso');

alter table public.help_requests enable row level security;
create policy help_requests_select on public.help_requests for select using (public.is_member(workspace_id));
create policy help_requests_insert on public.help_requests for insert with check (public.can_edit(workspace_id));
create policy help_requests_update on public.help_requests for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create trigger audit_help_requests after insert or update on public.help_requests
  for each row execute function public.audit_row();

-- Los pedidos creados como tareas "Ayuda" (versión anterior) pasan a pedidos de ayuda.
insert into public.help_requests (workspace_id, finding_id, requested_by, assignee_id, kind, ask, due_on, status, result, created_at)
select t.workspace_id, t.finding_id, t.created_by, t.assignee_id, 'contacto', t.title, t.due_on,
       case when t.status = 'done' then 'resuelto' else 'abierto' end,
       case when t.status = 'done' then 'Resuelto como tarea (sin resultado registrado).' end, t.created_at
from public.tasks t
where t.kind = 'Ayuda' and t.assignee_id is not null;
delete from public.tasks where kind = 'Ayuda' and assignee_id is not null;

-- La huella del audio se completa al procesar; el resto del registro del archivo sigue siendo inmutable.
revoke update on public.capture_media from authenticated;
grant update (sha256) on public.capture_media to authenticated;
create policy capture_media_update on public.capture_media for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
