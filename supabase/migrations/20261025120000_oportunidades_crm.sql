-- OPORTUNIDADES del CRM: cada fila (OP-###) queda referida a su oportunidad en RELEVO, como empresas,
-- contactos, actividades y fuentes.
alter table public.external_refs drop constraint external_refs_entity_type_check;
alter table public.external_refs add constraint external_refs_entity_type_check
  check (entity_type in ('company', 'establishment', 'campaign_target', 'contact', 'task', 'source', 'evidence', 'opportunity'));
