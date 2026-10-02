-- "Sacá ese terreno": RELEVO lo descarta en la misión (no se borra: queda el motivo y la historia) y se puede
-- deshacer. Acción auditada como las demás.
alter table public.ai_action_drafts drop constraint ai_action_drafts_action_check;
alter table public.ai_action_drafts add constraint ai_action_drafts_action_check
  check (action in ('create_task', 'draft_finding', 'request_decision', 'link_evidence', 'update_next_action', 'request_help', 'prepare_validation', 'record_web_evidence', 'contact_event', 'relationship_change', 'ingest_candidate', 'set_aside'));
