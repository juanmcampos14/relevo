-- =============================================================================
-- 0013 · Estado de un finding: qué sabemos, qué creemos, qué contradice, qué falta (incremento D)
-- Sin puntaje visible: dimensiones con estado y evidencia citada + faltantes explicables.
-- Las validaciones que propone la IA son propuestas: una persona las acepta (→ tarea) o rechaza.
-- =============================================================================

create table public.finding_assessments (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  finding_id        uuid not null,
  -- Evidencia considerada (para saber si quedó desactualizado cuando llega evidencia nueva).
  evidence_ids      uuid[] not null default '{}',
  -- [{key, status: sabido|creido|contradicho|falta, summary, evidence_ids[]}]
  dimensions        jsonb not null default '[]',
  -- Faltantes explicables (catálogo fijo en src/domain/readiness.ts).
  gaps              text[] not null default '{}',
  summary           text,
  supports          integer not null default 0,
  contradicts       integer not null default 0,
  independent_cases integer not null default 0,
  ai_run_id         uuid references public.ai_runs (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade
);
create index finding_assessments_latest_idx on public.finding_assessments (finding_id, created_at desc);

alter table public.finding_assessments enable row level security;
create policy finding_assessments_select on public.finding_assessments for select using (public.is_member(workspace_id));
create policy finding_assessments_insert on public.finding_assessments for insert with check (public.can_edit(workspace_id));
create trigger audit_finding_assessments after insert on public.finding_assessments
  for each row execute function public.audit_row();

-- Propuestas que nacen de la evaluación de un finding (validaciones), además de las de capturas.
alter table public.proposals
  alter column capture_id drop not null,
  add column finding_id    uuid,
  add column assessment_id uuid,
  add constraint proposals_origin check (num_nonnulls(capture_id, finding_id) = 1),
  add constraint proposals_finding_fk foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade,
  add constraint proposals_assessment_fk foreign key (workspace_id, assessment_id) references public.finding_assessments (workspace_id, id) on delete cascade,
  add constraint proposals_assessment_position unique (assessment_id, position);
create index proposals_finding_idx on public.proposals (finding_id) where finding_id is not null;
