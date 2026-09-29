-- =============================================================================
-- 0010 · Campos del CRM real que no tenían lugar (docs/03-migracion-crm-sheets.md §2)
-- =============================================================================

-- Subsector / actividad ("Hotel + viandas B2B", "Campamentos Oil & Gas / módulos").
alter table public.companies add column activity text;

-- Perfil público (LinkedIn/URL) y estado de la relación ("Por contactar", "En conversación"…).
alter table public.contacts
  add column profile_url         text check (profile_url is null or profile_url ~* '^https?://'),
  add column relationship_status text;

-- Fuente "crm": lo que el CRM cita sin URL (p. ej. "AOG Patagonia 2026 / sitio oficial Mobilbox")
-- y el propio CRM como origen de un registro importado.
alter table public.sources drop constraint sources_kind_check;
alter table public.sources add constraint sources_kind_check
  check (kind in ('url', 'documento', 'contacto', 'observacion', 'drive', 'research_externo', 'crm'));
