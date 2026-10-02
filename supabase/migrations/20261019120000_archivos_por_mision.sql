-- Los archivos (fotos y audios de las capturas) siguen los permisos de su misión: si no podés ver la captura,
-- no podés leer el archivo ni pedir un link firmado para abrirlo. Un archivo que todavía no tiene captura
-- (se está subiendo) sigue con la regla del workspace.
create or replace function public.storage_media_visible(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.capture_media cm where cm.storage_path = object_name)
      then exists (select 1 from public.capture_media cm where cm.storage_path = object_name and public.capture_visible(cm.capture_id))
    else true
  end;
$$;
revoke execute on function public.storage_media_visible(text) from public, anon;
grant execute on function public.storage_media_visible(text) to authenticated;

drop policy captures_objects_select on storage.objects;
create policy captures_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'captures' and public.is_member(public.storage_workspace(name)) and public.storage_media_visible(name));
