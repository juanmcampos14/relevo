-- Toda tarea sabe en qué misión nació: si se crea ligada a un objetivo de una misión y no dice la misión, la
-- hereda del objetivo (las tareas se leen por misión: sin esto, quedarían invisibles).
create or replace function public.task_campaign_from_target() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.campaign_id is null and new.target_id is not null then
    select ct.campaign_id into new.campaign_id from public.campaign_targets ct where ct.id = new.target_id;
  end if;
  return new;
end;
$$;
create trigger tasks_campaign_from_target before insert or update of target_id on public.tasks
  for each row execute function public.task_campaign_from_target();

-- Las que ya nacieron sin misión después de la migración anterior: la de su objetivo, o la primera misión.
update public.tasks t set campaign_id = ct.campaign_id from public.campaign_targets ct where t.target_id = ct.id and t.campaign_id is null;
with first_mission as (
  select distinct on (workspace_id) workspace_id, id from public.campaigns where kind = 'mision' order by workspace_id, created_at
)
update public.tasks t set campaign_id = m.id from first_mission m where t.workspace_id = m.workspace_id and t.campaign_id is null;
