-- "RELEVO ya trabajó": lo que el Brain prepara antes de que el usuario entre, para responder rápido.
-- 1. Síntesis diaria de la misión (qué haría hoy, esta semana, qué falta), precalculada en background.
alter table public.campaigns add column if not exists synthesis jsonb;
alter table public.campaigns add column if not exists synthesized_at timestamptz;
-- 2. Por qué importa cada objetivo de la misión: propósito, hipótesis, persona, qué sabemos, qué falta y el
--    objetivo del contacto. Lo arma RELEVO; el usuario corrige excepciones.
alter table public.campaign_targets add column if not exists briefing jsonb;
alter table public.campaign_targets add column if not exists briefed_at timestamptz;

-- 3. Acciones que RELEVO aplica solo (internas, reversibles, de alta confianza): "ya le escribí", "confirmó
--    el miércoles 11:30". Quedan auditadas como borrador ejecutado y se pueden deshacer.
alter table public.ai_action_drafts drop constraint ai_action_drafts_action_check;
alter table public.ai_action_drafts add constraint ai_action_drafts_action_check
  check (action in ('create_task', 'draft_finding', 'request_decision', 'link_evidence', 'update_next_action', 'request_help', 'prepare_validation', 'record_web_evidence', 'contact_event'));
alter table public.ai_action_drafts drop constraint ai_action_drafts_status_check;
alter table public.ai_action_drafts add constraint ai_action_drafts_status_check
  check (status in ('propuesta', 'aprobada', 'rechazada', 'ejecutada', 'error', 'deshecha'));
