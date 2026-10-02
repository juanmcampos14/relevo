-- Vigencia de las relaciones y RELEVO multi-misión.
-- 1. El Brain no borra historia: actualiza vigencia. Una persona que deja una empresa queda como relación
--    anterior (desde cuándo, por qué, con qué evidencia y con qué cargo), y se deja de recomendar ahí.
alter table public.contact_links
  add column valid_until date,
  add column ended_note text,
  add column ended_evidence_id uuid,
  add column role_title text,
  add constraint contact_links_ended_evidence_fk foreign key (workspace_id, ended_evidence_id) references public.evidence (workspace_id, id) on delete set null (ended_evidence_id);
comment on column public.contact_links.valid_until is 'Hasta cuándo valió la relación; null = vigente.';

-- 2. Correcciones conversacionales auditadas (y deshacibles), como los eventos de contacto.
alter table public.ai_action_drafts drop constraint ai_action_drafts_action_check;
alter table public.ai_action_drafts add constraint ai_action_drafts_action_check
  check (action in ('create_task', 'draft_finding', 'request_decision', 'link_evidence', 'update_next_action', 'request_help', 'prepare_validation', 'record_web_evidence', 'contact_event', 'relationship_change', 'ingest_candidate'));

-- 3. Multi-misión. RELEVO es el motor; la misión es el contexto. La memoria (empresas, personas, activos) es
--    global; lo que nace en una misión (hipótesis, capturas, evidencia, tareas, señales, plan, preguntas) sabe
--    en qué misión nació.
alter table public.context_documents add column campaign_id uuid,
  add constraint context_documents_campaign_fk foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id);
alter table public.research_questions add column campaign_id uuid,
  add constraint research_questions_campaign_fk foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id);
alter table public.tasks add column campaign_id uuid,
  add constraint tasks_campaign_fk foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id);
create index tasks_campaign_idx on public.tasks (workspace_id, campaign_id) where status <> 'done';
create index brief_signals_campaigns_idx on public.brief_signals using gin (campaign_ids);

-- Cómo vigila RELEVO cada misión durante el día (búsquedas, sitios, zona), y su contexto inicial.
alter table public.campaigns add column watch jsonb;
comment on column public.campaigns.watch is 'Vigilancia de la misión: {queries: string[], sites: string[], region: string|null, context: string|null}.';

-- Señales detectadas por la vigilancia durante el día (además del Morning Brief, el Radar y las capturas).
alter table public.brief_signals drop constraint brief_signals_origin_check;
alter table public.brief_signals add constraint brief_signals_origin_check check (origin in ('brief', 'radar_sheet', 'captura', 'vigilancia'));
alter table public.brief_signals add column alerted_at timestamptz;

-- Lo existente sin misión pertenecía a la primera misión de cada workspace (Vaca Muerta / Añelo).
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.findings f set campaign_id = m.id from first_mission m where f.workspace_id = m.workspace_id and f.campaign_id is null;
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.evidence e set campaign_id = m.id from first_mission m where e.workspace_id = m.workspace_id and e.campaign_id is null;
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.context_documents d set campaign_id = m.id from first_mission m where d.workspace_id = m.workspace_id and d.campaign_id is null;
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.research_questions q set campaign_id = m.id from first_mission m where q.workspace_id = m.workspace_id and q.campaign_id is null;
update public.tasks t set campaign_id = ct.campaign_id from public.campaign_targets ct where t.target_id = ct.id and t.campaign_id is null;
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.tasks t set campaign_id = m.id from first_mission m where t.workspace_id = m.workspace_id and t.campaign_id is null;
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.brief_signals s set campaign_ids = array[m.id] from first_mission m where s.workspace_id = m.workspace_id and cardinality(s.campaign_ids) = 0;

-- Los activos del Radar los sigue la primera misión (como sus empresas): quedan como objetivos de la misión.
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
insert into public.campaign_targets (workspace_id, campaign_id, asset_id)
select a.workspace_id, m.id, a.id from public.assets a join first_mission m on m.workspace_id = a.workspace_id
where a.radar_ref is not null and not exists (select 1 from public.campaign_targets t where t.campaign_id = m.id and t.asset_id = a.id);

-- 4. Lo que RELEVO encuentra entra solo cuando es claro (auditado y deshacible); si hay duda, queda una sola
--    pregunta, no una bandeja. Las acciones automáticas pueden no venir de una conversación.
alter table public.ai_action_drafts alter column conversation_id drop not null;
alter table public.brief_candidates alter column brief_id drop not null;
alter table public.brief_candidates add column campaign_id uuid,
  add column question text,
  add column maybe_ref text,
  add constraint brief_candidates_campaign_fk foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id);

-- Deshacer una corrección: quien la hizo puede borrar la evidencia que creó (en las últimas 24 horas).
create policy evidence_delete_own_recent on public.evidence for delete
  using (public.can_edit(workspace_id) and created_by = auth.uid() and created_at > now() - interval '1 day');
