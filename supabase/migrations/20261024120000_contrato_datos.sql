-- Contrato de datos con el CRM (docs/12 y docs/13). Todo aditivo: lo que ya existe sigue funcionando.

-- 1. Una actividad puede quedar cancelada (no hecha, no pendiente) y conserva su historial.
--    Prioridad y bloque de preparación vienen tal cual del CRM (ACTIVIDADES, columnas R y S).
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelada'));
alter table public.tasks
  add column prep_priority text,
  add column prep_block    text;

-- 2. Paradas del campo (RUTA | VISITAS y AOG): una cámara u organismo es una organización, no una empresa
--    ni un lugar. stop_class guarda la clasificación aprobada (empresa, ubicación, organización, sesión,
--    recorrido, a definir, logística, empresa sin ID) y crm_status el estado literal del CRM.
alter table public.visit_stops drop constraint visit_stops_kind_check;
alter table public.visit_stops add constraint visit_stops_kind_check
  check (kind in ('empresa', 'persona', 'lugar', 'evento', 'zona', 'libre', 'organizacion'));
alter table public.visit_stops drop constraint visit_stops_kind_target;
alter table public.visit_stops add constraint visit_stops_kind_target check (
  (kind = 'empresa' and target_id is not null)
  or (kind = 'persona' and (contact_id is not null or length(trim(coalesce(label, ''))) > 0))
  or (kind in ('lugar', 'evento', 'zona', 'libre', 'organizacion') and length(trim(coalesce(label, ''))) > 0)
);
-- La misma empresa puede estar dos veces en un día (YPF en la ruta del 20/10 y en el mapa de AOG): cada
-- parada se identifica por su fila del CRM (external_ref), no por empresa + jornada.
alter table public.visit_stops drop constraint visit_stops_plan_id_target_id_key;
alter table public.visit_stops
  add column stop_class text check (stop_class in ('empresa', 'ubicacion', 'organizacion', 'sesion', 'recorrido', 'a_definir', 'logistica', 'empresa_sin_id')),
  add column crm_status text;

-- 3. Candidatos al CRM: lo que RELEVO conoce y el CRM (registro maestro) todavía no. No entran solos al
--    CRM: quedan acá con su procedencia, evidencia y el posible duplicado que se haya detectado.
create table public.crm_candidates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  campaign_id     uuid,
  kind            text not null check (kind in ('empresa', 'persona', 'organizacion')),
  name            text not null check (length(trim(name)) > 0),
  entity_type     text check (entity_type in ('company', 'contact')),
  entity_id       uuid,
  provenance      text not null,
  detail          text,
  source_url      text,
  possible_duplicate text,
  status          text not null default 'pendiente' check (status in ('pendiente', 'incorporada_al_crm', 'descartada')),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique nulls not distinct (workspace_id, kind, name, entity_id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id)
);
alter table public.crm_candidates enable row level security;
create policy crm_candidates_select on public.crm_candidates for select using (public.is_member(workspace_id));
create policy crm_candidates_update on public.crm_candidates for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy crm_candidates_mission on public.crm_candidates as restrictive for select using (campaign_id is null or public.can_see_campaign(campaign_id));
create trigger audit_crm_candidates after insert or update on public.crm_candidates for each row execute function public.audit_row();
