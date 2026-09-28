-- =============================================================================
-- 0006 · Una sola actualización de noticias a la vez por workspace y tema.
-- Evita la "estampida": varias renderizaciones/precargas simultáneas veían las
-- noticias vencidas y cada una consultaba al proveedor.
-- =============================================================================

create table public.news_refresh_state (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  topic         text not null,
  locked_until  timestamptz,
  last_ok_at    timestamptz,
  primary key (workspace_id, topic)
);
alter table public.news_refresh_state enable row level security;
create policy news_refresh_state_select on public.news_refresh_state for select using (public.is_member(workspace_id));

-- Reserva atómica: devuelve true SOLO a quien gana. p_stale = antigüedad mínima de la
-- última actualización exitosa (0 para "Actualizar" manual). La reserva vence sola.
create or replace function public.claim_news_refresh(p_ws uuid, p_topic text, p_stale interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  won boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_edit(p_ws) then
    return false;
  end if;
  insert into public.news_refresh_state (workspace_id, topic) values (p_ws, p_topic)
  on conflict do nothing;
  update public.news_refresh_state
     set locked_until = now() + interval '2 minutes'
   where workspace_id = p_ws and topic = p_topic
     and (locked_until is null or locked_until < now())
     and (last_ok_at is null or last_ok_at < now() - p_stale)
  returning true into won;
  return coalesce(won, false);
end $$;

-- Cierre: éxito libera y marca la hora; error deja un respiro de 15 minutos.
create or replace function public.finish_news_refresh(p_ws uuid, p_topic text, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_edit(p_ws) then
    return;
  end if;
  update public.news_refresh_state
     set locked_until = case when p_ok then null else now() + interval '15 minutes' end,
         last_ok_at = case when p_ok then now() else last_ok_at end
   where workspace_id = p_ws and topic = p_topic;
end $$;

revoke execute on function public.claim_news_refresh(uuid, text, interval), public.finish_news_refresh(uuid, text, boolean) from public, anon;
grant execute on function public.claim_news_refresh(uuid, text, interval), public.finish_news_refresh(uuid, text, boolean) to authenticated, service_role;
