-- =============================================================================
-- Seed SOLO PARA DESARROLLO LOCAL (`npx supabase db reset`). No se usa en staging/prod.
-- Usuarios locales de prueba (contraseña de desarrollo: relevo-local-2026):
--   tano@relevo.local  → owner, puede aprobar decisiones
--   fran@relevo.local  → admin, puede aprobar decisiones (capacidad independiente del rol)
--   visor@relevo.local → viewer (solo lectura) para probar permisos
-- Estructura real del piloto: workspace Daicou, campaña Añelo — Discovery 2026 y
-- verticales iniciales. NO se cargan empresas, activos ni visitas: los 3 casos
-- reales los aporta Tano; cualquier dato ficticio debe marcarse is_demo = true.
-- =============================================================================

do $$
declare
  u_tano uuid := '11111111-1111-4111-8111-111111111111';
  u_fran uuid := '22222222-2222-4222-8222-222222222222';
  u_visor uuid := '33333333-3333-4333-8333-333333333333';
  ws uuid := 'dac00000-0000-4000-8000-000000000001';
  camp uuid := 'dac00000-0000-4000-8000-0000000000c1';
  u record;
begin
  for u in
    select * from (values
      (u_tano, 'tano@relevo.local', 'Tano'),
      (u_fran, 'fran@relevo.local', 'Fran'),
      (u_visor, 'visor@relevo.local', 'Visor (prueba)')
    ) as t(id, email, name)
  loop
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
      crypt('relevo-local-2026', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.name), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;

  insert into public.workspaces (id, name, slug, created_by) values (ws, 'Daicou', 'daicou', u_tano);
  insert into public.memberships (workspace_id, user_id, role, can_approve_decisions) values
    (ws, u_tano, 'owner', true),
    (ws, u_fran, 'admin', true),
    (ws, u_visor, 'viewer', false);

  insert into public.campaigns (id, workspace_id, name, zone, objective, status, owner_id, created_by)
  values (camp, ws, 'Añelo — Discovery 2026', 'Añelo / Vaca Muerta, Neuquén',
          'Originar e investigar oportunidades alrededor del crecimiento de Añelo, en cualquier vertical.',
          'activa', u_tano, u_tano);

  insert into public.verticals (workspace_id, name, created_by)
  select ws, v, u_tano
  from unnest(array['Gastronomía', 'Fitness', 'Alojamiento', 'Servicios', 'Comercios',
                    'Inmuebles y tierra', 'Fondos de comercio', 'Logística']) as v;

  insert into public.campaign_verticals (workspace_id, campaign_id, vertical_id)
  select ws, camp, id from public.verticals where workspace_id = ws;
end $$;
