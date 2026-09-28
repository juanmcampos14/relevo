-- =============================================================================
-- 0007 · Noticias con imagen de preview y enlace real a la nota.
-- Bing Noticias pasa a ser la fuente principal (trae miniatura, URL original y
-- resumen). Las notas de Google Noticias sin hallazgo vinculado se eliminan: sus
-- enlaces eran redirecciones de Google y no tenían imagen; se vuelven a traer.
-- =============================================================================

alter table public.news_articles
  add column image_url text check (image_url is null or image_url ~* '^https://');

delete from public.news_articles where provider = 'google_news_rss' and finding_id is null;

-- Fuerza una actualización con la nueva fuente en la próxima visita.
update public.news_refresh_state set last_ok_at = null, locked_until = null;
