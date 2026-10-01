-- Una entidad de RELEVO puede tener varios IDs del Sheet: empresas unificadas (AN-0096 → AN-0035) y
-- fuentes del CRM con la misma URL. external_id sigue siendo único por tipo; la entidad ya no.
alter table public.external_refs drop constraint if exists external_refs_workspace_id_entity_type_entity_id_source_sys_key;
