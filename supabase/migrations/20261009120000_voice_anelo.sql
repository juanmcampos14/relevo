-- =============================================================================
-- Voice of Añelo (Ruta A): experimento de investigación con formulario propio en RELEVO.
-- Respuestas en la base de RELEVO con acceso restringido (owner/admin); nadie pasa al CRM.
-- Atribución por URL (sin píxel); métricas de Meta por CSV; aprobaciones con decisions (can_approve).
-- La ruta pública escribe con el cliente de servicio, validando todo del lado del servidor.
-- =============================================================================

create or replace function public.is_research_admin(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role(ws, array['owner', 'admin']);
$$;
revoke execute on function public.is_research_admin(uuid) from public, anon;
grant execute on function public.is_research_admin(uuid) to authenticated;

create table public.research_experiments (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  slug                text not null check (slug ~ '^[a-z0-9-]+$'),
  title               text not null,
  purpose             text,
  -- borrador (solo con enlace de revisión) → piloto (enlace de revisión, cohorte piloto) → activo (público,
  -- requiere presupuesto y publicación aprobados) → pausado / cerrado.
  status              text not null default 'borrador' check (status in ('borrador', 'piloto', 'activo', 'pausado', 'cerrado')),
  campaign_id         uuid,
  responsible_name    text,
  contact_email       text check (contact_email is null or position('@' in contact_email) > 1),
  privacy_notice      text,
  retention_days      integer not null default 365 check (retention_days between 30 and 1095),
  preview_token_hash  text,
  budget_stage1_usd   numeric(10, 2),
  budget_cap_usd      numeric(10, 2),
  budget_decision_id      uuid,
  publication_decision_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique (slug)
);

create table public.experiment_variants (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  experiment_id  uuid not null,
  code           text not null check (code ~ '^[A-Z][0-9A-Z]*$'),
  label          text not null,
  primary_text   text not null,
  headline       text not null,
  cta            text not null,
  creative_ref   text,
  what_changes   text,
  meta_campaign_id text,
  meta_adset_id    text,
  meta_ad_id       text,
  status         text not null default 'borrador' check (status in ('borrador', 'aprobada', 'activa', 'pausada')),
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  unique (experiment_id, code),
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade
);

-- Cuestionario inmutable por versión: una respuesta siempre sabe con qué preguntas se contestó.
create table public.survey_versions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  experiment_id  uuid not null,
  version        text not null,
  definition     jsonb not null,
  definition_sha text not null,
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  unique (experiment_id, version),
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade
);
create or replace function public.survey_versions_immutable()
returns trigger language plpgsql as $$
begin
  if new.definition is distinct from old.definition or new.version is distinct from old.version then
    raise exception 'una versión del cuestionario no se modifica: creá una nueva';
  end if;
  return new;
end $$;
create trigger survey_versions_immutable before update on public.survey_versions
  for each row execute function public.survey_versions_immutable();

-- Una visita a la landing. ID pseudónimo; sin IP (solo un hash que rota por día para frenar abusos).
create table public.survey_sessions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  experiment_id      uuid not null,
  version_id         uuid not null,
  cohort             text not null check (cohort in ('prueba', 'piloto', 'real')),
  variant_code       text,
  attribution        text not null default 'desconocido' check (attribution in ('meta', 'otro', 'desconocido')),
  utm                jsonb not null default '{}',
  meta               jsonb not null default '{}',
  referrer_host      text,
  device             text check (device in ('movil', 'escritorio', 'otro')),
  quick_tap_shown    boolean not null default false,
  quick_tap          text,
  ip_hash_day        text,
  landing_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  outcome            text check (outcome in ('completa', 'fuera_de_alcance')),
  last_question      text,
  flagged            text,
  delete_after       date not null,
  unique (workspace_id, id),
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, version_id) references public.survey_versions (workspace_id, id)
);
create index survey_sessions_exp_idx on public.survey_sessions (experiment_id, cohort, landing_at);
create index survey_sessions_ip_idx on public.survey_sessions (experiment_id, ip_hash_day, landing_at);

create table public.survey_events (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null,
  session_id   uuid not null,
  kind         text not null check (kind in ('vista', 'inicio', 'toque', 'pregunta', 'fuera_de_alcance', 'completa')),
  question     text,
  at           timestamptz not null default now(),
  foreign key (workspace_id, session_id) references public.survey_sessions (workspace_id, id) on delete cascade
);
create index survey_events_session_idx on public.survey_events (session_id, at);

-- Respuesta completa: DECLARACIÓN (aunque relate un hecho). Texto libre con datos personales se redacta
-- al revisarla; el original no se conserva después de la revisión.
create table public.survey_responses (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  session_id     uuid not null unique,
  experiment_id  uuid not null,
  version_id     uuid not null,
  cohort         text not null check (cohort in ('prueba', 'piloto', 'real')),
  answers        jsonb not null,
  answers_hash   text not null,
  eligible       boolean not null,
  useful         boolean not null,
  pii_detected   boolean not null default false,
  duplicate_of   uuid,
  review_status  text not null default 'pendiente' check (review_status in ('pendiente', 'revisada', 'descartada')),
  review_note    text,
  reviewed_by    uuid references auth.users (id) on delete set null,
  reviewed_at    timestamptz,
  deletion_code  text not null unique,
  created_at     timestamptz not null default now(),
  delete_after   date not null,
  unique (workspace_id, id),
  foreign key (workspace_id, session_id) references public.survey_sessions (workspace_id, id) on delete cascade,
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade
);
create index survey_responses_exp_idx on public.survey_responses (experiment_id, cohort);

-- CSV exportado de Ads Manager: el archivo y su período quedan; reimportar reemplaza por (día, anuncio).
create table public.ad_metric_imports (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  experiment_id  uuid not null,
  file_name      text not null,
  file_sha256    text not null,
  file_text      text not null,
  period_start   date,
  period_end     date,
  currency       text,
  account_timezone text,
  rows_total     integer not null default 0,
  rows_applied   integer not null default 0,
  rejected       jsonb not null default '[]',
  unmatched      jsonb not null default '[]',
  imported_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade
);

create table public.ad_metrics_daily (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  experiment_id    uuid not null,
  day              date not null,
  meta_campaign_id text,
  meta_adset_id    text,
  meta_ad_id       text not null,
  ad_name          text,
  variant_code     text,
  currency         text not null,
  spend            numeric(12, 2) not null default 0,
  impressions      integer,
  reach            integer,
  link_clicks      integer,
  landing_page_views integer,
  import_id        uuid not null,
  updated_at       timestamptz not null default now(),
  unique (experiment_id, day, meta_ad_id),
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, import_id) references public.ad_metric_imports (workspace_id, id)
);

-- Costo total facturado (impuestos, percepciones, honorarios) separado del gasto que informa Meta.
create table public.experiment_costs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  experiment_id  uuid not null,
  kind           text not null check (kind in ('facturado_meta', 'iva', 'percepcion', 'ingresos_brutos', 'honorarios', 'otro')),
  amount         numeric(12, 2) not null,
  currency       text not null check (currency in ('ARS', 'USD')),
  fx_rate        numeric(12, 4),
  period         text,
  document_ref   text,
  notes          text,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade
);

-- Aprobaciones del experimento (presupuesto, publicación) con la misma regla que el resto: can_approve.
alter table public.decisions add column experiment_id uuid;
alter table public.decisions add constraint decisions_experiment_fk foreign key (workspace_id, experiment_id) references public.research_experiments (workspace_id, id) on delete cascade;
alter table public.decisions drop constraint decisions_kind_check;
alter table public.decisions add constraint decisions_kind_check check (kind in ('general', 'aprobar_oportunidad', 'aprobar_presupuesto', 'aprobar_publicacion'));
alter table public.decisions add constraint decisions_experiment_kind check (kind not in ('aprobar_presupuesto', 'aprobar_publicacion') or experiment_id is not null);
create unique index decisions_one_open_experiment on public.decisions (experiment_id, kind) where experiment_id is not null and status = 'requested';

-- Evidencia desde respuestas revisadas: origen propio (encuesta), declaración, vinculada a la respuesta.
alter table public.evidence drop constraint evidence_origin_kind_check;
alter table public.evidence add constraint evidence_origin_kind_check check (origin_kind in ('field', 'interview', 'conversation', 'website', 'public_registry', 'press',
  'aog', 'crm_import', 'email', 'manual', 'ai_research', 'survey'));
alter table public.evidence add column survey_response_id uuid;
alter table public.evidence add constraint evidence_survey_response_fk foreign key (workspace_id, survey_response_id) references public.survey_responses (workspace_id, id) on delete set null (survey_response_id);

alter table public.research_experiments enable row level security;
alter table public.experiment_variants enable row level security;
alter table public.survey_versions enable row level security;
alter table public.survey_sessions enable row level security;
alter table public.survey_events enable row level security;
alter table public.survey_responses enable row level security;
alter table public.ad_metric_imports enable row level security;
alter table public.ad_metrics_daily enable row level security;
alter table public.experiment_costs enable row level security;

create policy research_experiments_select on public.research_experiments for select using (public.is_member(workspace_id));
create policy research_experiments_insert on public.research_experiments for insert with check (public.is_research_admin(workspace_id));
create policy experiment_variants_insert on public.experiment_variants for insert with check (public.is_research_admin(workspace_id));
create policy survey_versions_insert on public.survey_versions for insert with check (public.is_research_admin(workspace_id));
create policy research_experiments_update on public.research_experiments for update using (public.is_research_admin(workspace_id)) with check (public.is_research_admin(workspace_id));
create policy experiment_variants_select on public.experiment_variants for select using (public.is_member(workspace_id));
create policy experiment_variants_update on public.experiment_variants for update using (public.is_research_admin(workspace_id)) with check (public.is_research_admin(workspace_id));
create policy survey_versions_select on public.survey_versions for select using (public.is_member(workspace_id));
-- Datos de sesiones y respuestas: solo owner/admin.
create policy survey_sessions_select on public.survey_sessions for select using (public.is_research_admin(workspace_id));
create policy survey_events_select on public.survey_events for select using (public.is_research_admin(workspace_id));
create policy survey_responses_select on public.survey_responses for select using (public.is_research_admin(workspace_id));
create policy survey_responses_update on public.survey_responses for update using (public.is_research_admin(workspace_id)) with check (public.is_research_admin(workspace_id));
create policy survey_responses_delete on public.survey_responses for delete using (public.is_research_admin(workspace_id));
create policy survey_sessions_delete on public.survey_sessions for delete using (public.is_research_admin(workspace_id));
create policy ad_metric_imports_select on public.ad_metric_imports for select using (public.is_member(workspace_id));
create policy ad_metric_imports_insert on public.ad_metric_imports for insert with check (public.is_research_admin(workspace_id));
create policy ad_metrics_daily_select on public.ad_metrics_daily for select using (public.is_member(workspace_id));
create policy ad_metrics_daily_insert on public.ad_metrics_daily for insert with check (public.is_research_admin(workspace_id));
create policy ad_metrics_daily_update on public.ad_metrics_daily for update using (public.is_research_admin(workspace_id)) with check (public.is_research_admin(workspace_id));
create policy experiment_costs_select on public.experiment_costs for select using (public.is_member(workspace_id));
create policy experiment_costs_insert on public.experiment_costs for insert with check (public.is_research_admin(workspace_id));

create trigger audit_research_experiments after insert or update on public.research_experiments for each row execute function public.audit_row();
create trigger audit_experiment_variants after insert or update on public.experiment_variants for each row execute function public.audit_row();
create trigger audit_survey_responses after update on public.survey_responses for each row execute function public.audit_row();
create trigger audit_ad_metric_imports after insert on public.ad_metric_imports for each row execute function public.audit_row();
create trigger audit_experiment_costs after insert on public.experiment_costs for each row execute function public.audit_row();
