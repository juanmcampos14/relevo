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

## Staging / producción (pendiente)

1. Crear proyecto Supabase y Vercel; variables de `.env.example` en Vercel (la secret key solo del lado servidor).
2. `npx supabase link` + `npx supabase db push` (migraciones; **no** correr `seed.sql`).
3. Configurar en Supabase Auth: alta pública deshabilitada, `Site URL` = URL de Vercel, redirect `https://<dominio>/**`,
   y las plantillas `supabase/templates/*.html` (invitación y magic link apuntan a `/auth/confirm`).
4. Crear el workspace Daicou y el owner (script de bootstrap: pendiente).
