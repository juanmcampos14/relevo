-- =============================================================================
-- 0015 · Entidades sin identificar, evolución de hipótesis y madurez (idea → hipótesis → finding)
-- - "Una contratista sin nombre", "un chofer de una petrolera": fuentes válidas de evidencia que
--   todavía no son una empresa ni una persona del CRM. Quedan guardadas y relacionadas; cuando se
--   sabe quiénes son, se resuelven contra la empresa/persona real y su evidencia se transfiere
--   (sin perder la historia: la evidencia conserva a quién apuntaba antes).
-- - La evidencia nueva puede apoyar, contradecir, acotar, ampliar o segmentar una hipótesis:
--   cada cambio de enunciado o de madurez queda registrado.
-- - Aceptar una hipótesis exploratoria no la vuelve un finding consolidado: la promoción es humana.
-- =============================================================================

create table public.unresolved_entities (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  kind                 text not null check (kind in ('organization', 'actor')),
  -- Cómo se lo reconoce: "Contratista con ~35 personas en la zona", "Encargado de esa contratista".
  label                text not null,
  description          text,
  -- Un actor puede pertenecer a una organización todavía sin identificar.
  parent_id            uuid,
  capture_id           uuid,
  resolved_company_id  uuid,
  resolved_contact_id  uuid,
  resolved_at          timestamptz,
  resolved_by          uuid references auth.users (id) on delete set null,
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, parent_id) references public.unresolved_entities (workspace_id, id) on delete set null (parent_id),
  foreign key (workspace_id, capture_id) references public.captures (workspace_id, id) on delete set null (capture_id),
  foreign key (workspace_id, resolved_company_id) references public.companies (workspace_id, id) on delete set null (resolved_company_id),
  foreign key (workspace_id, resolved_contact_id) references public.contacts (workspace_id, id) on delete set null (resolved_contact_id),
  check (kind = 'organization' or resolved_company_id is null),
  check (kind = 'actor' or resolved_contact_id is null)
);
create index unresolved_entities_open_idx on public.unresolved_entities (workspace_id) where resolved_at is null;

alter table public.unresolved_entities enable row level security;
create policy unresolved_entities_select on public.unresolved_entities for select using (public.is_member(workspace_id));
create policy unresolved_entities_insert on public.unresolved_entities for insert with check (public.can_edit(workspace_id));
create policy unresolved_entities_update on public.unresolved_entities for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create trigger audit_unresolved_entities after insert or update on public.unresolved_entities
  for each row execute function public.audit_row();

-- La evidencia puede ser sobre una organización sin identificar o dicha por un actor sin identificar.
alter table public.evidence
  add column about_unresolved_id     uuid,
  add column stated_by_unresolved_id uuid,
  add constraint evidence_about_unresolved_fk foreign key (workspace_id, about_unresolved_id)
    references public.unresolved_entities (workspace_id, id) on delete set null (about_unresolved_id),
  add constraint evidence_stated_by_unresolved_fk foreign key (workspace_id, stated_by_unresolved_id)
    references public.unresolved_entities (workspace_id, id) on delete set null (stated_by_unresolved_id);
create index evidence_about_unresolved_idx on public.evidence (about_unresolved_id) where about_unresolved_id is not null;
create index evidence_stated_by_unresolved_idx on public.evidence (stated_by_unresolved_id) where stated_by_unresolved_id is not null;

alter table public.proposals drop constraint proposals_result_type_check;
alter table public.proposals add constraint proposals_result_type_check
  check (result_type is null or result_type in ('company', 'asset', 'contact', 'evidence', 'finding', 'task', 'unresolved'));

-- Madurez: idea del capturador → hipótesis (exploratoria) → finding (patrón sustentado).
alter table public.findings
  add column maturity text not null default 'finding' check (maturity in ('idea', 'hipotesis', 'finding'));
update public.findings set maturity = 'hipotesis' where review_note = 'Promovido desde una captura';

create table public.finding_revisions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  finding_id     uuid not null,
  -- enunciado: la evidencia acotó/amplió/segmentó la hipótesis · madurez: idea → hipótesis → finding.
  kind           text not null check (kind in ('enunciado', 'madurez')),
  relation       text check (relation in ('acota', 'amplia', 'segmenta')),
  previous_value text not null,
  new_value      text not null,
  reason         text,
  capture_id     uuid,
  proposal_id    uuid,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade,
  foreign key (workspace_id, capture_id) references public.captures (workspace_id, id) on delete set null (capture_id)
);
create index finding_revisions_finding_idx on public.finding_revisions (finding_id, created_at);

alter table public.finding_revisions enable row level security;
create policy finding_revisions_select on public.finding_revisions for select using (public.is_member(workspace_id));
create policy finding_revisions_insert on public.finding_revisions for insert with check (public.can_edit(workspace_id));
create trigger audit_finding_revisions after insert on public.finding_revisions
  for each row execute function public.audit_row();

-- "Qué todavía no sabemos" de cada captura procesada (capa ejecutiva de la revisión).
alter table public.captures add column ai_unknowns text[] not null default '{}';

-- Un finding revisado no se edita a mano; sí puede reformularse por evidencia nueva (acota, amplía,
-- segmenta) a través de refine_finding, que deja la revisión registrada en la misma transacción.
create or replace function public.findings_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.review_status <> 'pendiente_revision' and new.review_status = old.review_status
       and (new.statement, new.evidence, new.kind, new.source_id)
           is distinct from (old.statement, old.evidence, old.kind, old.source_id)
       and not (coalesce(current_setting('relevo.refining', true), '') = old.id::text
                and (new.evidence, new.kind, new.source_id) is not distinct from (old.evidence, old.kind, old.source_id)) then
      raise exception 'finding revisado: volvelo a pendiente antes de editar su contenido';
    end if;
    if new.review_status is distinct from old.review_status then
      if new.review_status = 'pendiente_revision' then
        new.reviewed_by := null;
        new.reviewed_at := null;
      else
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
      end if;
    end if;
  elsif tg_op = 'INSERT' and new.review_status <> 'pendiente_revision' then
    raise exception 'un finding nace pendiente de revisión';
  end if;
  return new;
end $$;

-- Corre con los permisos de quien llama (RLS aplica): solo quien puede editar el workspace.
create or replace function public.refine_finding(
  p_finding_id uuid, p_statement text, p_relation text, p_reason text, p_capture_id uuid, p_proposal_id uuid
) returns void language plpgsql security invoker as $$
declare
  f record;
begin
  select id, workspace_id, statement into f from public.findings where id = p_finding_id for update;
  if not found then raise exception 'finding no encontrado'; end if;
  if f.statement = p_statement then return; end if;
  insert into public.finding_revisions (workspace_id, finding_id, kind, relation, previous_value, new_value, reason, capture_id, proposal_id)
  values (f.workspace_id, f.id, 'enunciado', p_relation, f.statement, p_statement, p_reason, p_capture_id, p_proposal_id);
  perform set_config('relevo.refining', f.id::text, true);
  update public.findings set statement = p_statement where id = f.id;
  perform set_config('relevo.refining', '', true);
end $$;
