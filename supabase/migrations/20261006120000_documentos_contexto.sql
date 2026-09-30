-- Documentos de contexto (presentaciones, metodología) que RELEVO puede consultar.
-- Jerarquía: evidencia actual → memoria operativa → decisiones → fuentes → documentos de contexto.
-- Un documento de contexto explica por qué y cómo se pensó el trabajo; nunca es evidencia de campo.
create table public.context_documents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  kind          text not null default 'contexto' check (kind in ('metodologia', 'contexto')),
  summary       text,
  body          text not null check (length(trim(body)) > 0),
  source_url    text check (source_url is null or source_url ~* '^https?://'),
  status        text not null default 'vigente' check (status in ('vigente', 'archivado')),
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, title)
);

alter table public.context_documents enable row level security;
create policy context_documents_select on public.context_documents for select using (public.is_member(workspace_id));
create policy context_documents_insert on public.context_documents for insert with check (public.can_edit(workspace_id));
create policy context_documents_update on public.context_documents for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create trigger audit_context_documents after insert or update on public.context_documents
  for each row execute function public.audit_row();

-- Sector tal como lo declara el CRM (subsector/actividad). La vertical se asigna aparte, contra la taxonomía acordada.
alter table public.companies add column sector text;
