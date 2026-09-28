// Harness de pruebas de base de datos: corre contra el Postgres local de Supabase
// (`npx supabase start`) y ejecuta consultas COMO un usuario autenticado real,
// con el mismo mecanismo que PostgREST (role authenticated + request.jwt.claims),
// para que RLS aplique exactamente como en producción.
import { randomUUID } from "node:crypto";
import pg from "pg";

export const DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type TestUser = { id: string; email: string };

export function newPool() {
  return new pg.Pool({ connectionString: DB_URL, max: 4 });
}

export async function createUser(pool: pg.Pool, label: string): Promise<TestUser> {
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@test.local`;
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '',
       now(), '{}', '{}', now(), now())`,
    [id, email],
  );
  return { id, email };
}

export async function createWorkspace(pool: pg.Pool, name: string): Promise<string> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query(
    `insert into public.workspaces (name, slug) values ($1, $2) returning id`,
    [name, slug],
  );
  return rows[0].id;
}

export async function addMember(
  pool: pg.Pool,
  workspaceId: string,
  user: TestUser,
  role: "owner" | "admin" | "member" | "viewer",
  canApprove = false,
) {
  await pool.query(
    `insert into public.memberships (workspace_id, user_id, role, can_approve_decisions)
     values ($1, $2, $3, $4)`,
    [workspaceId, user.id, role, canApprove],
  );
}

/** Ejecuta `fn` dentro de una transacción como `user` (RLS activa). Hace ROLLBACK salvo commit=true. */
export async function asUser<T>(
  pool: pg.Pool,
  user: TestUser,
  fn: (c: pg.PoolClient) => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: user.id, email: user.email, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function cleanup(pool: pg.Pool, workspaceIds: string[], users: TestUser[]) {
  if (workspaceIds.length) {
    await pool.query(`delete from public.workspaces where id = any($1::uuid[])`, [workspaceIds]);
  }
  if (users.length) {
    await pool.query(`delete from auth.users where id = any($1::uuid[])`, [users.map((u) => u.id)]);
  }
}
