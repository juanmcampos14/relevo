-- =============================================================================
-- 0009 · Modelo canónico (docs/04-modelo-canonico.md)
-- - Verificación: unverified · partially_verified · publicly_verified · field_verified
--   · contradicted · stale. "Demo" es la marca is_demo; "declarado por contacto" es origen.
-- - evidence: observación/dato atómico con origen, verificación y frescura (absorbe claims).
-- - finding_evidence: postura de cada evidencia frente a un finding (a favor/en contra/contexto).
-- - external_refs + import_batches/import_rows: procedencia e importación revisable desde Sheets.
-- - asset_parties: activo ↔ empresa/persona con rol (nunca "quien publica = propietario").
-- - Etapas del objetivo en el idioma del CRM.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo de verificación
-- ---------------------------------------------------------------------------
alter table public.companies      drop constraint companies_check1;
alter table public.establishments drop constraint establishments_check4;
alter table public.assets         drop constraint assets_check5;
alter table public.contacts       drop constraint contacts_check;
alter table public.claims         drop constraint claims_check1;

-- Transición: el catálogo acepta ambos mientras se convierten los datos.
create or replace function public.is_verification_status(v text)
returns boolean language sql immutable as $$
  select v in ('unverified', 'partially_verified', 'publicly_verified', 'field_verified', 'contradicted', 'stale',
               'confirmado', 'declarado_por_contacto', 'fuente_publica_sin_verificar', 'hipotesis', 'demo');
$$;

do $$
declare
  t text;
begin
  -- Tablas con marca DEMO: el estado 'demo' pasa a la marca.
  foreach t in array array['companies', 'establishments', 'assets', 'contacts'] loop
    execute format('update public.%I set is_demo = true where verification_status = ''demo''', t);
  end loop;
  foreach t in array array['companies', 'establishments', 'assets', 'contacts', 'claims', 'findings'] loop
    execute format($f$
      update public.%1$I set verification_status = case verification_status
        when 'confirmado' then 'publicly_verified'
        when 'declarado_por_contacto' then 'partially_verified'
        when 'fuente_publica_sin_verificar' then 'partially_verified'
        else 'unverified' end
      where verification_status in ('confirmado', 'declarado_por_contacto', 'fuente_publica_sin_verificar', 'hipotesis', 'demo')$f$, t);
    execute format('alter table public.%I alter column verification_status set default ''unverified''', t);
  end loop;
end $$;

-- Lo confirmado en una visita es verificación de campo.
update public.findings set verification_status = 'field_verified'
 where verification_status = 'publicly_verified' and visit_id is not null;

create or replace function public.is_verification_status(v text)
returns boolean language sql immutable as $$
  select v in ('unverified', 'partially_verified', 'publicly_verified', 'field_verified', 'contradicted', 'stale');
$$;

-- Nada verificado (ni contradicho) sin fuente.
alter table public.companies      add constraint companies_verified_needs_source      check (verification_status = 'unverified' or source_id is not null);
alter table public.establishments add constraint establishments_verified_needs_source check (verification_status = 'unverified' or source_id is not null);
alter table public.assets         add constraint assets_verified_needs_source         check (verification_status = 'unverified' or source_id is not null);
alter table public.contacts       add constraint contacts_verified_needs_source       check (verification_status = 'unverified' or source_id is not null);

-- ---------------------------------------------------------------------------
-- 2. Datos que trae el CRM real
-- ---------------------------------------------------------------------------
alter table public.companies
  add column public_phone     text,
  add column tax_id           text,
  add column drive_folder_url text check (drive_folder_url is null or drive_folder_url ~* '^https?://');
create index companies_tax_id_idx on public.companies (workspace_id, tax_id) where tax_id is not null;

-- Un contacto puede ser una persona o un canal institucional ("Compras de YPF").
alter table public.contacts
  add column contact_kind text not null default 'persona' check (contact_kind in ('persona', 'canal_institucional'));

alter table public.sources
  add column quality text check (quality is null or quality in ('alta', 'media', 'baja'));

-- Follow-ups vinculados a una persona y con canal/tipo (Correo, Llamada, AOG…).
alter table public.tasks
  add column contact_id uuid,
  add column kind       text,
  add column channel    text,
  add constraint tasks_contact_fk foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id);

-- ---------------------------------------------------------------------------
-- 3. Evidencia
-- ---------------------------------------------------------------------------
create table public.evidence (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  statement            text not null check (length(trim(statement)) > 0),
  quote                text,
  evidence_type        text not null default 'dato'
                        check (evidence_type in ('dato', 'declaracion', 'observacion', 'precio', 'capacidad', 'contacto',
                                                 'propiedad', 'documento', 'publicacion', 'otro')),
  verification_status  text not null default 'unverified' check (public.is_verification_status(verification_status)),
  origin_kind          text not null
                        check (origin_kind in ('field', 'interview', 'conversation', 'website', 'public_registry', 'press',
                                               'aog', 'crm_import', 'email', 'manual', 'ai_research')),
  observed_at          timestamptz,
  revalidate_after     date,
  next_verification_step text,
  source_id            uuid,
  capture_id           uuid,
  capture_media_id     uuid,
  media_start_ms       integer check (media_start_ms is null or media_start_ms >= 0),
  media_end_ms         integer,
  visit_id             uuid,
  stated_by_contact_id uuid,
  campaign_id          uuid,
  company_id           uuid,
  establishment_id     uuid,
  asset_id             uuid,
  contact_id           uuid,
  is_demo              boolean not null default false,
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, id),
  check (num_nonnulls(company_id, establishment_id, asset_id) <= 1),
  check (media_end_ms is null or media_end_ms >= coalesce(media_start_ms, 0)),
  -- Verificada o contradicha solo con un origen comprobable: fuente, captura o visita.
  check (verification_status = 'unverified' or num_nonnulls(source_id, capture_id, visit_id) > 0),
  foreign key (workspace_id, source_id) references public.sources (workspace_id, id),
  foreign key (workspace_id, capture_id) references public.captures (workspace_id, id) on delete set null (capture_id),
  foreign key (workspace_id, capture_media_id) references public.capture_media (workspace_id, id) on delete set null (capture_media_id),
  foreign key (workspace_id, visit_id) references public.visits (workspace_id, id) on delete set null (visit_id),
  foreign key (workspace_id, stated_by_contact_id) references public.contacts (workspace_id, id) on delete set null (stated_by_contact_id),
  foreign key (workspace_id, campaign_id) references public.campaigns (workspace_id, id) on delete set null (campaign_id),
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, establishment_id) references public.establishments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade,
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade
);
create index evidence_company_idx on public.evidence (company_id) where company_id is not null;
create index evidence_establishment_idx on public.evidence (establishment_id) where establishment_id is not null;
create index evidence_asset_idx on public.evidence (asset_id) where asset_id is not null;
create index evidence_contact_idx on public.evidence (contact_id) where contact_id is not null;
create index evidence_capture_idx on public.evidence (capture_id) where capture_id is not null;

-- claims → evidence (lo que sabíamos de cada entidad conserva su fuente y fecha).
insert into public.evidence (id, workspace_id, statement, verification_status, origin_kind, observed_at, next_verification_step,
                             source_id, company_id, establishment_id, asset_id, contact_id, created_by, created_at, updated_at)
select id, workspace_id, statement, verification_status, case when source_id is null then 'manual' else 'website' end,
       created_at, next_verification_step, source_id, company_id, establishment_id, asset_id, contact_id, created_by, created_at, updated_at
  from public.claims;
drop table public.claims;

create table public.finding_evidence (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  finding_id   uuid not null,
  evidence_id  uuid not null,
  stance       text not null check (stance in ('supports', 'contradicts', 'contextual')),
  note         text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  primary key (finding_id, evidence_id),
  foreign key (workspace_id, finding_id) references public.findings (workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id) references public.evidence (workspace_id, id) on delete cascade
);
create index finding_evidence_evidence_idx on public.finding_evidence (evidence_id);

-- ---------------------------------------------------------------------------
-- 4. Activos: partes con rol
-- ---------------------------------------------------------------------------
create table public.asset_parties (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  asset_id            uuid not null,
  company_id          uuid,
  contact_id          uuid,
  role                text not null check (role in ('propietario', 'operador', 'intermediario', 'administrador',
                                                    'potencial_comprador', 'potencial_socio')),
  verification_status text not null default 'unverified' check (public.is_verification_status(verification_status)),
  evidence_id         uuid,
  notes               text,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique nulls not distinct (asset_id, company_id, contact_id, role),
  check (num_nonnulls(company_id, contact_id) = 1),
  check (verification_status = 'unverified' or evidence_id is not null),
  foreign key (workspace_id, asset_id) references public.assets (workspace_id, id) on delete cascade,
  foreign key (workspace_id, company_id) references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, evidence_id) references public.evidence (workspace_id, id) on delete set null (evidence_id)
);

insert into public.asset_parties (workspace_id, asset_id, company_id, role, created_by, created_at)
select workspace_id, id, owner_company_id, 'propietario', created_by, created_at from public.assets where owner_company_id is not null;
alter table public.assets drop column owner_company_id;

-- ---------------------------------------------------------------------------
-- 5. Etapas del objetivo (CRM)
-- ---------------------------------------------------------------------------
alter table public.campaign_targets drop constraint campaign_targets_status_check;
update public.campaign_targets set status = case status
  when 'identificado' then 'investigacion'
  when 'por_investigar' then 'investigacion'
  when 'por_contactar' then 'contacto_pendiente'
  when 'contactado' then 'contactado'
  when 'visita_programada' then 'reunion'
  when 'visitado' then 'diagnostico'
  when 'seguimiento' then 'diagnostico'
  else status end;
alter table public.campaign_targets
  alter column status set default 'investigacion',
  add constraint campaign_targets_status_check check (status in ('investigacion', 'calificacion', 'contacto_pendiente', 'contactado',
                                                                  'reunion', 'diagnostico', 'oportunidad', 'descartado'));

-- ---------------------------------------------------------------------------
-- 6. Procedencia externa e importación revisable
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  source_system  text not null check (source_system in ('google_sheets')),
  file_name      text not null,
  file_sha256    text not null,
  source_file_id text,
  status         text not null default 'en_revision' check (status in ('en_revision', 'aplicado', 'descartado')),
  summary        jsonb not null default '{}',
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  unique (workspace_id, id)
);

create table public.import_rows (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  batch_id         uuid not null,
  entity_type      text not null check (entity_type in ('company', 'contact', 'task', 'source')),
  external_id      text not null,
  sheet            text not null,
  row_number       integer not null,
  raw              jsonb not null,
  mapped           jsonb not null default '{}',
  action           text not null check (action in ('crear', 'actualizar', 'sin_cambios', 'conflicto', 'rechazar')),
  target_entity_id uuid,
  issues           jsonb not null default '[]',
  conflicts        jsonb not null default '[]',
  decision         text not null default 'pendiente' check (decision in ('pendiente', 'aprobada', 'rechazada')),
  resolution       jsonb not null default '{}',
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  applied_at       timestamptz,
  unique (workspace_id, id),
  unique (batch_id, entity_type, external_id),
  foreign key (workspace_id, batch_id) references public.import_batches (workspace_id, id) on delete cascade
);
create index import_rows_batch_idx on public.import_rows (batch_id, decision);

-- ID de origen ↔ entidad RELEVO. last_values = lo último importado (base del diff en tres sentidos).
create table public.external_refs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  source_system     text not null check (source_system in ('google_sheets')),
  external_id       text not null,
  entity_type       text not null check (entity_type in ('company', 'establishment', 'campaign_target', 'contact', 'task', 'source', 'evidence')),
  entity_id         uuid not null,
  source_file_id    text,
  sheet             text,
  row_number        integer,
  last_values       jsonb not null default '{}',
  last_batch_id     uuid,
  first_imported_at timestamptz not null default now(),
  last_imported_at  timestamptz not null default now(),
  unique (workspace_id, source_system, external_id, entity_type),
  unique (workspace_id, entity_type, entity_id, source_system),
  foreign key (workspace_id, last_batch_id) references public.import_batches (workspace_id, id) on delete set null (last_batch_id)
);
create index external_refs_entity_idx on public.external_refs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 7. RLS, updated_at y auditoría
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['evidence', 'finding_evidence', 'asset_parties', 'import_batches', 'import_rows', 'external_refs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.is_member(workspace_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.has_role(workspace_id, array[''owner'', ''admin'']))', t);
  end loop;
  foreach t in array array['evidence', 'asset_parties'] loop
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
  -- import_rows no se audita: la fila original y la decisión ya quedan en la propia tabla.
  foreach t in array array['evidence', 'finding_evidence', 'asset_parties', 'import_batches', 'external_refs'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;
