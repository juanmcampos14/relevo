-- Field MVP · Bloque A (modelo). Todo es aditivo: el código anterior sigue funcionando con esta base.

-- 1. Parada generalizada: una parada de la jornada puede ser una empresa (objetivo de la misión), una
--    persona, un lugar, un evento, una zona o una actividad libre ("broker por identificar", "recorrido").
--    Lugares, zonas y eventos son TIPOS de parada (nombre + ubicación), no entidades nuevas.
alter table public.visit_stops alter column target_id drop not null;
alter table public.visit_stops
  add column kind          text not null default 'empresa' check (kind in ('empresa', 'persona', 'lugar', 'evento', 'zona', 'libre')),
  add column label         text,
  add column contact_id    uuid,
  add column latitude      double precision,
  add column longitude     double precision,
  add column time_slot     text,
  add column objective     text,
  add column key_question  text,
  add column outcome       text,
  add column external_ref  text,
  add foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id);
alter table public.visit_stops add constraint visit_stops_kind_target check (
  (kind = 'empresa' and target_id is not null)
  or (kind = 'persona' and (contact_id is not null or length(trim(coalesce(label, ''))) > 0))
  or (kind in ('lugar', 'evento', 'zona', 'libre') and length(trim(coalesce(label, ''))) > 0)
);
-- Estados: se suman "en curso" y "cancelada" (planificada = programada/confirmada; hecha = realizada; salteada = no_realizada).
alter table public.visit_stops drop constraint visit_stops_status_check;
alter table public.visit_stops add constraint visit_stops_status_check
  check (status in ('programada', 'confirmada', 'en_curso', 'realizada', 'no_realizada', 'cancelada'));
create unique index visit_stops_external_ref on public.visit_stops (plan_id, external_ref) where external_ref is not null;

-- Captura ↔ parada: lo que se graba al salir de una visita sabe de qué parada salió.
alter table public.captures add column stop_id uuid,
  add foreign key (workspace_id, stop_id) references public.visit_stops (workspace_id, id) on delete set null (stop_id);

-- 2. Próxima acción canónica = tarea (responsable, fecha, estado, vínculo). Se suma el vínculo a parada y activo.
alter table public.tasks
  add column stop_id  uuid,
  add column asset_id uuid,
  add foreign key (workspace_id, stop_id) references public.visit_stops (workspace_id, id) on delete set null (stop_id),
  add foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete set null (asset_id);

-- 3. Precedencia humana: lo que una persona corrigió no lo pisa una ingesta automática (como ya pasa con
--    los activos). Lo que llega distinto queda como discrepancia para decidir, con su fuente.
alter table public.companies add column locked_fields text[] not null default '{}';
alter table public.contacts add column locked_fields text[] not null default '{}';
alter table public.establishments add column locked_fields text[] not null default '{}';

create table public.source_discrepancies (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  entity_type     text not null check (entity_type in ('company', 'contact', 'establishment', 'asset', 'signal')),
  entity_id       uuid not null,
  field           text not null,
  current_value   text,
  incoming_value  text,
  source          text not null,
  source_ref      text,
  source_url      text,
  status          text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'descartada')),
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, id)
);
-- Una sola discrepancia abierta por campo y valor entrante (reimportar no la duplica).
create unique index source_discrepancies_open on public.source_discrepancies (entity_type, entity_id, field, coalesce(incoming_value, '')) where status = 'pendiente';
alter table public.source_discrepancies enable row level security;
create policy source_discrepancies_select on public.source_discrepancies for select using (public.is_member(workspace_id));
create policy source_discrepancies_insert on public.source_discrepancies for insert with check (public.can_edit(workspace_id));
create policy source_discrepancies_update on public.source_discrepancies for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create trigger audit_source_discrepancies after insert or update on public.source_discrepancies for each row execute function public.audit_row();

-- 4. Candidato / oportunidad. Puede nacer de una empresa, un activo, hallazgos o una brecha de mercado
--    (ninguno obligatorio: greenfield no tiene empresa target). Carril de captura de valor, madurez
--    explícita, unidad económica y una ficha progresiva (jsonb tipado en src/domain/candidate.ts):
--    negocio, demanda, limitante, capacidad, palanca, economics, riesgos, próxima validación. No es un
--    formulario: se completa desde la evidencia.
alter table public.opportunities drop constraint opportunities_route_check;
alter table public.opportunities add constraint opportunities_route_check
  check (route in ('adquisicion', 'participacion', 'gestion', 'alianza', 'creacion_propia', 'conexion', 'a_definir'));
alter table public.opportunities
  add column company_id    uuid,
  add column asset_id      uuid,
  add column gap           text,
  add column lane          text not null default 'a_definir' check (lane in ('negocio_existente', 'greenfield', 'a_definir')),
  add column maturity      text not null default 'candidato' check (maturity in ('candidato', 'cuantificando', 'validando', 'validada', 'caso_inversion')),
  add column economic_unit text,
  add column card          jsonb not null default '{}',
  add foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete set null (company_id),
  add foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete set null (asset_id);
-- Validada (o caso de inversión) exige más que un candidato: la oportunidad aprobada por decisión, que a su
-- vez exige al menos un hallazgo aprobado (guard existente).
alter table public.opportunities add constraint opportunities_validated_needs_approval
  check (maturity not in ('validada', 'caso_inversion') or status = 'aprobada');

-- Quién usa / quién decide / quién paga (y operador, competidor…): relación con empresas o personas
-- existentes, o una etiqueta cuando el actor es genérico ("trabajador", "RR.HH.").
create table public.opportunity_parties (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  opportunity_id  uuid not null,
  role            text not null check (role in ('consumidor', 'decisor', 'pagador', 'operador', 'proveedor', 'competidor', 'socio_potencial')),
  company_id      uuid,
  contact_id      uuid,
  label           text,
  evidence_id     uuid,
  note            text,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  check (company_id is not null or contact_id is not null or length(trim(coalesce(label, ''))) > 0),
  foreign key (workspace_id, opportunity_id) references public.opportunities (workspace_id, id) on delete cascade,
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id) references public.evidence (workspace_id, id) on delete set null (evidence_id)
);
create index opportunity_parties_opp_idx on public.opportunity_parties (opportunity_id);

create or replace function public.opportunity_visible(p_opportunity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_campaign(o.campaign_id) from public.opportunities o where o.id = p_opportunity), false);
$$;
create or replace function public.opportunity_workable(p_opportunity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select o.campaign_id is null or public.can_work_campaign(o.campaign_id) from public.opportunities o where o.id = p_opportunity), false);
$$;
revoke execute on function public.opportunity_visible(uuid), public.opportunity_workable(uuid) from public, anon;
grant execute on function public.opportunity_visible(uuid), public.opportunity_workable(uuid) to authenticated;

alter table public.opportunity_parties enable row level security;
create policy opportunity_parties_select on public.opportunity_parties for select using (public.is_member(workspace_id));
create policy opportunity_parties_insert on public.opportunity_parties for insert with check (public.can_edit(workspace_id));
create policy opportunity_parties_update on public.opportunity_parties for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
create policy opportunity_parties_delete on public.opportunity_parties for delete using (public.can_edit(workspace_id));
create policy opportunity_parties_mission_select on public.opportunity_parties as restrictive for select using (public.opportunity_visible(opportunity_id));
create policy opportunity_parties_mission_insert on public.opportunity_parties as restrictive for insert with check (public.opportunity_workable(opportunity_id));
create policy opportunity_parties_mission_update on public.opportunity_parties as restrictive for update using (public.opportunity_workable(opportunity_id));
create policy opportunity_parties_mission_delete on public.opportunity_parties as restrictive for delete using (public.opportunity_workable(opportunity_id));
create trigger audit_opportunity_parties after insert or update or delete on public.opportunity_parties for each row execute function public.audit_row();

-- 5. Rol de la persona en la red (cómo accedemos al territorio), independiente de su empresa.
alter table public.contacts add column network_roles text[] not null default '{}'
  check (network_roles <@ array['dueno', 'operador', 'comprador', 'experto', 'originador', 'referidor']::text[]);
