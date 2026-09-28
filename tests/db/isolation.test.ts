// Prueba de aceptación #1/#11 del documento maestro: aislamiento entre workspaces,
// permisos por rol y capacidad de aprobar independiente del rol.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  asUser,
  cleanup,
  createUser,
  createWorkspace,
  newPool,
  type TestUser,
} from "./harness";

const pool = newPool();
let wsA: string, wsB: string;
let owner: TestUser, adminApprover: TestUser, adminNoApprove: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser;
let companyA: string, companyB: string, campaignA: string;

beforeAll(async () => {
  wsA = await createWorkspace(pool, "Workspace A");
  wsB = await createWorkspace(pool, "Workspace B");
  owner = await createUser(pool, "owner");
  adminApprover = await createUser(pool, "fran");
  adminNoApprove = await createUser(pool, "admin");
  member = await createUser(pool, "member");
  viewer = await createUser(pool, "viewer");
  outsider = await createUser(pool, "outsider");
  await addMember(pool, wsA, owner, "owner", true);
  await addMember(pool, wsA, adminApprover, "admin", true);
  await addMember(pool, wsA, adminNoApprove, "admin", false);
  await addMember(pool, wsA, member, "member");
  await addMember(pool, wsA, viewer, "viewer");
  await addMember(pool, wsB, outsider, "owner", true);

  companyA = (
    await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Empresa A') returning id`, [wsA])
  ).rows[0].id;
  companyB = (
    await pool.query(`insert into companies (workspace_id, trade_name) values ($1, 'Empresa B') returning id`, [wsB])
  ).rows[0].id;
  campaignA = (
    await pool.query(`insert into campaigns (workspace_id, name) values ($1, 'Campaña A') returning id`, [wsA])
  ).rows[0].id;
});

afterAll(async () => {
  await cleanup(pool, [wsA, wsB], [owner, adminApprover, adminNoApprove, member, viewer, outsider]);
  await pool.end();
});

describe("aislamiento entre workspaces", () => {
  it("un usuario de B no ve workspaces, empresas ni campañas de A", async () => {
    const r = await asUser(pool, outsider, async (c) => ({
      ws: (await c.query(`select id from workspaces where id = $1`, [wsA])).rowCount,
      companies: (await c.query(`select id from companies where workspace_id = $1`, [wsA])).rowCount,
      campaigns: (await c.query(`select id from campaigns where id = $1`, [campaignA])).rowCount,
      memberships: (await c.query(`select id from memberships where workspace_id = $1`, [wsA])).rowCount,
      audit: (await c.query(`select id from audit_log where workspace_id = $1`, [wsA])).rowCount,
    }));
    expect(r).toEqual({ ws: 0, companies: 0, campaigns: 0, memberships: 0, audit: 0 });
  });

  it("un usuario de B no puede insertar en A", async () => {
    await expect(
      asUser(pool, outsider, (c) =>
        c.query(`insert into companies (workspace_id, trade_name) values ($1, 'Intrusa')`, [wsA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("un usuario de B no puede modificar ni borrar filas de A", async () => {
    const r = await asUser(pool, outsider, async (c) => ({
      upd: (await c.query(`update companies set notes = 'x' where id = $1`, [companyA])).rowCount,
      del: (await c.query(`delete from companies where id = $1`, [companyA])).rowCount,
    }));
    expect(r).toEqual({ upd: 0, del: 0 });
  });

  it("no se puede vincular un registro de A con uno de B aunque se conozca el UUID", async () => {
    await expect(
      asUser(pool, owner, (c) =>
        c.query(`insert into campaign_targets (workspace_id, campaign_id, company_id) values ($1, $2, $3)`, [
          wsA,
          campaignA,
          companyB,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("un usuario de B no puede autoasignarse membresía en A", async () => {
    await expect(
      asUser(pool, outsider, (c) =>
        c.query(`insert into memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [wsA, outsider.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("roles y capacidades dentro de A", () => {
  it("todos los miembros (incluido viewer) leen todo el workspace", async () => {
    for (const u of [owner, adminApprover, member, viewer]) {
      const n = await asUser(pool, u, async (c) => (await c.query(`select id from companies`)).rowCount);
      expect(n).toBe(1);
    }
  });

  it("viewer no puede crear ni editar", async () => {
    await expect(
      asUser(pool, viewer, (c) =>
        c.query(`insert into companies (workspace_id, trade_name) values ($1, 'X')`, [wsA]),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await asUser(pool, viewer, async (c) =>
      (await c.query(`update companies set notes = 'x' where id = $1`, [companyA])).rowCount,
    );
    expect(upd).toBe(0);
  });

  it("member crea y edita, pero no borra; admin sí borra", async () => {
    const created = await asUser(pool, member, async (c) => {
      const { rows } = await c.query(
        `insert into companies (workspace_id, trade_name) values ($1, 'Nueva') returning id, created_by`,
        [wsA],
      );
      const del = (await c.query(`delete from companies where id = $1`, [rows[0].id])).rowCount;
      return { createdBy: rows[0].created_by, del };
    });
    expect(created).toEqual({ createdBy: member.id, del: 0 });

    const del = await asUser(pool, adminNoApprove, async (c) => {
      const { rows } = await c.query(`insert into companies (workspace_id, trade_name) values ($1, 'Borrable') returning id`, [wsA]);
      return (await c.query(`delete from companies where id = $1`, [rows[0].id])).rowCount;
    });
    expect(del).toBe(1);
  });

  it("can_approve_decisions es independiente del rol", async () => {
    const check = (u: TestUser) =>
      asUser(pool, u, async (c) => (await c.query(`select public.can_approve($1) as ok`, [wsA])).rows[0].ok);
    expect(await check(adminApprover)).toBe(true); // Fran: admin con capacidad
    expect(await check(adminNoApprove)).toBe(false); // admin sin capacidad
    expect(await check(member)).toBe(false);
    expect(await check(outsider)).toBe(false); // owner de otro workspace
  });

  it("un viewer nunca puede tener capacidad de aprobar", async () => {
    await expect(
      pool.query(`update memberships set can_approve_decisions = true where user_id = $1`, [viewer.id]),
    ).rejects.toThrow(/viewer_cannot_approve/);
  });

  it("solo el owner gestiona membresías; un admin no puede darse la capacidad de aprobar", async () => {
    const upd = await asUser(pool, adminNoApprove, async (c) =>
      (await c.query(`update memberships set can_approve_decisions = true where user_id = $1`, [adminNoApprove.id])).rowCount,
    );
    expect(upd).toBe(0);
  });

  it("las preferencias de inicio son privadas y no dan acceso", async () => {
    await asUser(
      pool,
      member,
      (c) => c.query(`insert into user_preferences (user_id, workspace_id, home) values ($1, $2, '{"widgets":[]}')`, [member.id, wsA]),
      { commit: true },
    );
    const seenByOther = await asUser(pool, adminApprover, async (c) =>
      (await c.query(`select 1 from user_preferences where user_id = $1`, [member.id])).rowCount,
    );
    expect(seenByOther).toBe(0);
    await expect(
      asUser(pool, outsider, (c) =>
        c.query(`insert into user_preferences (user_id, workspace_id) values ($1, $2)`, [outsider.id, wsA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("invitaciones", () => {
  it("member no puede invitar; admin no puede invitar con capacidad de aprobar; owner sí", async () => {
    await expect(
      asUser(pool, member, (c) =>
        c.query(`insert into workspace_invitations (workspace_id, email, role, invited_by) values ($1, 'a@b.com', 'member', $2)`, [
          wsA,
          member.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(pool, adminNoApprove, (c) =>
        c.query(
          `insert into workspace_invitations (workspace_id, email, role, can_approve_decisions, invited_by) values ($1, 'a@b.com', 'admin', true, $2)`,
          [wsA, adminNoApprove.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("al aceptar, el invitado recibe rol y capacidad exactos de la invitación", async () => {
    const invitee = await createUser(pool, "invitee");
    try {
      await asUser(
        pool,
        owner,
        (c) =>
          c.query(
            `insert into workspace_invitations (workspace_id, email, role, can_approve_decisions, invited_by) values ($1, $2, 'admin', true, $3)`,
            [wsA, invitee.email, owner.id],
          ),
        { commit: true },
      );
      const accepted = await asUser(
        pool,
        invitee,
        async (c) => (await c.query(`select public.accept_pending_invitations() as n`)).rows[0].n,
        { commit: true },
      );
      expect(accepted).toBe(1);
      const m = await pool.query(`select role, can_approve_decisions from memberships where user_id = $1`, [invitee.id]);
      expect(m.rows[0]).toEqual({ role: "admin", can_approve_decisions: true });
      // Reaceptar es idempotente.
      const again = await asUser(pool, invitee, async (c) => (await c.query(`select public.accept_pending_invitations() as n`)).rows[0].n);
      expect(again).toBe(0);
    } finally {
      await pool.query(`delete from auth.users where id = $1`, [invitee.id]);
    }
  });
});

describe("auditoría", () => {
  it("registra autor, hora y solo los campos cambiados; es inmutable", async () => {
    await asUser(pool, member, (c) => c.query(`update campaigns set status = 'activa' where id = $1`, [campaignA]), {
      commit: true,
    });
    const { rows } = await pool.query(
      `select actor_id, action, changes from audit_log where entity_id = $1 and action = 'update' order by id desc limit 1`,
      [campaignA],
    );
    expect(rows[0].actor_id).toBe(member.id);
    expect(rows[0].changes).toEqual({ status: { de: "borrador", a: "activa" } });
    await expect(pool.query(`delete from audit_log where entity_id = $1`, [campaignA])).rejects.toThrow(/append-only/);
    await expect(
      asUser(pool, owner, (c) => c.query(`insert into audit_log (workspace_id, action, entity_type) values ($1, 'x', 'y')`, [wsA])),
    ).rejects.toThrow(/row-level security/);
  });
});
