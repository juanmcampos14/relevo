# RELEVO OS (nombre provisional)

Plataforma multi-workspace de originación e investigación de oportunidades.
Primer workspace: **Daicou** · campaña piloto **Añelo — Discovery 2026**.

Plan, auditoría y alcance: [`docs/00-auditoria-y-plan-p0.md`](docs/00-auditoria-y-plan-p0.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · Supabase (Postgres, Auth, RLS) · zod · vitest.
La tenencia (workspaces, memberships, capacidades, audit log append-only) está adaptada de RUN72-monorepo.

## Correr en local

Requisitos: Node 24, Docker Desktop abierto.

```bash
npm install
npm run db:start          # levanta Supabase local (primera vez descarga imágenes)
npx supabase status -o env # copiar URL y claves a .env.local (ver .env.example)
npm run db:reset          # aplica migraciones + seed local
npm run dev               # http://localhost:3000
```

Usuarios de prueba **solo locales**: ver `supabase/seed.sql` (Tano owner, Fran admin con capacidad de aprobar, Visor solo lectura).
Emails locales (invitaciones, enlaces de acceso): Mailpit en http://127.0.0.1:54324.

## Pruebas

```bash
npm run check   # lint + typecheck + tests
```

- `tests/db/isolation.test.ts`: aislamiento entre workspaces, roles, `can_approve_decisions` independiente del rol, invitaciones, auditoría inmutable. Corre contra el Postgres local **como usuario autenticado** (RLS efectiva).
- `tests/db/data-rules.test.ts`: reglas de honestidad de datos (fuente obligatoria para "confirmado", precio con moneda/fecha/fuente, coordenadas solo verificadas, descarte con motivo…).
- `src/domain/maps.test.ts`: enlaces de Google Maps.

## Reglas de arquitectura

- Las páginas y server actions usan **el cliente con la sesión del usuario**: toda lectura/escritura pasa por RLS.
- `src/lib/supabase/admin.ts` (secret key) se usa **solo** para enviar invitaciones de Auth, después de que RLS aceptó la invitación.
- Preferencias de usuario ≠ permisos. Rol y capacidades viven en `memberships`.
- FK compuestas `(workspace_id, id)`: imposible vincular registros de otro workspace.
- Todo dato ficticio lleva `is_demo = true` (se ve como **DEMO**).
- Funciones no construidas se muestran como "no disponible", nunca simuladas.

## Producción

- App: https://relevo-juan-campos.vercel.app (Vercel `juan-campos/relevo`, funciones en `pdx1`).
- Base: Supabase `RELEVO` (`edsykefncxjonwlxlamp`, us-west-2). Migraciones: `npx supabase db push --linked` (nunca el seed).
- Auth: alta pública deshabilitada; solo invitaciones. En plan gratis se usan los emails por defecto de Supabase:
  invitación → `/auth/callback` (sesión en el fragmento), enlace mágico → `/auth/confirm?code=` (PKCE).
  Las plantillas de `supabase/templates` solo aplican en local o con SMTP propio.
- Alta de un workspace nuevo: `node --env-file=.env.production.local scripts/bootstrap-workspace.mjs --name … --slug … --owner …`.
- Deploy: mientras el email de los commits no esté en la cuenta de Vercel, Vercel bloquea los deploys con metadatos de git;
  se despliega una exportación limpia (`git archive HEAD`) con `npx vercel deploy --prod`.
