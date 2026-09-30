-- =============================================================================
-- Investigación en RELEVO: hipótesis H-VA, preguntas (entrevista, Voice, reglas) y verticales con código.
-- Migración reejecutable desde INVESTIGACIÓN | ENTREVISTAS: los IDs del Sheet se conservan (dedup_key /
-- code) y volver a correrla no duplica. Desde la migración, hipótesis y preguntas se editan en RELEVO.
-- =============================================================================

-- Verticales con identificador estable (V01…): la etiqueta puede cambiar sin perder historia.
alter table public.verticals
  add column code text,
  add column front text,
  add column definition text,
  add column provisional boolean not null default false;
create unique index verticals_code_uq on public.verticals (workspace_id, code) where code is not null;

-- Preguntas de investigación: de entrevista (AOG / campo), del cuestionario Voice, reglas de método y control.
create table public.research_questions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  code            text not null check (length(trim(code)) > 0),
  kind            text not null check (kind in ('entrevista', 'voice', 'regla', 'control')),
  industry        text,
  dimension       text,
  question        text not null check (length(trim(question)) > 0),
  evidence_asked  text,
  hypothesis_text text,
  next_action     text,
  owner_name      text,
  source_url      text check (source_url is null or source_url ~* '^https?://'),
  vertical_id     uuid,
  status          text not null default 'vigente' check (status in ('vigente', 'archivada')),
  origin          text not null default 'crm' check (origin in ('crm', 'relevo')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code),
  foreign key (workspace_id, vertical_id) references public.verticals (workspace_id, id) on delete set null (vertical_id)
);

create table public.question_findings (
  workspace_id uuid not null,
  question_id  uuid not null,
  finding_id   uuid not null,
  primary key (question_id, finding_id),
  foreign key (workspace_id, question_id) references public.research_questions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade
);
create index question_findings_finding_idx on public.question_findings (finding_id);

-- Empresas del "universo existente" de una hipótesis (a quién preguntar, no evidencia).
create table public.finding_companies (
  workspace_id uuid not null,
  finding_id   uuid not null,
  company_id   uuid not null,
  role         text not null default 'universo' check (role in ('universo', 'afectada', 'compradora', 'proveedora')),
  primary key (finding_id, company_id),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade,
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade
);
create index finding_companies_company_idx on public.finding_companies (company_id);

-- Borrador de contacto (p. ej. AOG) que vive en la nota de celda del CRM: propuesta, nunca enviada por RELEVO.
alter table public.contacts add column outreach_draft text;

alter table public.research_questions enable row level security;
alter table public.question_findings enable row level security;
alter table public.finding_companies enable row level security;
create policy research_questions_select on public.research_questions for select using (public.is_member(workspace_id));
create policy research_questions_insert on public.research_questions for insert with check (public.can_edit(workspace_id));
create policy research_questions_update on public.research_questions for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy question_findings_select on public.question_findings for select using (public.is_member(workspace_id));
create policy question_findings_insert on public.question_findings for insert with check (public.can_edit(workspace_id));
create policy question_findings_delete on public.question_findings for delete using (public.can_edit(workspace_id));
create policy finding_companies_select on public.finding_companies for select using (public.is_member(workspace_id));
create policy finding_companies_insert on public.finding_companies for insert with check (public.can_edit(workspace_id));
create policy finding_companies_delete on public.finding_companies for delete using (public.can_edit(workspace_id));
create trigger audit_research_questions after insert or update on public.research_questions
  for each row execute function public.audit_row();
