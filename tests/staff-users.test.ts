/**
 * Usuarios del personal sobre el esquema real de D1 (node:sqlite) y Better Auth de verdad:
 * alta con el hasher de la config (el login funciona), email repetido, edición, bloqueo y corte de sesiones,
 * y las protecciones (repartidores, uno mismo, último dueño activo, incluso con pedidos simultáneos).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth } from "../src/lib/data/auth.ts";
import { createCourierUserWith, sessionUserWith, toSessionUser } from "../src/lib/data/session.ts";
import { ForbiddenError, type Actor } from "../src/lib/data/actor.ts";
import { createStaffUser, listStaffUsers, updateStaffUser } from "../src/lib/data/staff-users.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const SECRET = crypto.randomUUID() + crypto.randomUUID();
const PASSWORD = "clave-segura-123";

function setup() {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: SECRET, baseURL: BASE });
  return { db, auth };
}
type Ctx = ReturnType<typeof setup>;

const asAdmin = (userId: string): Actor => ({ kind: "admin", userId });
const system: Actor = { kind: "system", reason: "test" };

let ipCounter = 0;
async function signIn(auth: Ctx["auth"], email: string, password: string) {
  return auth.handler(
    new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": `10.9.0.${++ipCounter}` },
      body: JSON.stringify({ email, password }),
    }),
  );
}
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

function insertUser(ctx: Ctx, id: string, role: string, staffRole: string | null, extra: { banned?: number; email?: string } = {}) {
  const now = new Date().toISOString();
  ctx.db.raw
    .prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, banned, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(id, id, extra.email ?? `${id}@x.test`, role, staffRole, extra.banned ?? 0, now, now);
}

const row = (ctx: Ctx, id: string) =>
  ctx.db.raw.prepare(`SELECT role, staff_role, permissions, banned, legal_version, emailVerified FROM "user" WHERE id = ?`).get(id) as {
    role: string; staff_role: string | null; permissions: string | null; banned: number; legal_version: string | null; emailVerified: number;
  };
const sessionCount = (ctx: Ctx, id: string) => (ctx.db.raw.prepare(`SELECT count(*) AS n FROM "session" WHERE userId = ?`).get(id) as { n: number }).n;

function expectOk<T>(r: { ok: true; value: T } | { ok: false; status: number; error: string }): T {
  assert.ok(r.ok, r.ok ? "" : `${r.status} ${r.error}`);
  return r.value;
}

describe("alta de usuarios del personal", () => {
  it("crea gerente con el hasher de Better Auth: el login funciona y la sesión trae rol y permisos", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    const created = expectOk(await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), {
      name: "  Marta  ", email: "Marta@Local.TEST ", password: PASSWORD, staffRole: "gerente", permissions: { catalogo: "view", configuracion: "view" },
    }));
    assert.equal(created.name, "Marta");
    assert.equal(created.email, "marta@local.test");
    assert.equal(created.staffRole, "gerente");
    assert.equal(created.permissions.catalogo, "view");
    assert.equal(created.permissions.pedidos, "edit");

    const r = row(ctx, created.id);
    assert.equal(r.role, "admin", "acceso al portal");
    assert.equal(r.staff_role, "gerente");
    assert.deepEqual(JSON.parse(r.permissions ?? "null"), { catalogo: "view" }, "solo lo que difiere del default (configuracion: view ya es el default)");
    assert.equal(r.legal_version, null, "tiene que aceptar Términos al entrar");
    assert.equal(r.emailVerified, 1);
    const account = ctx.db.raw.prepare(`SELECT providerId, accountId, password FROM "account" WHERE userId = ?`).get(created.id) as { providerId: string; accountId: string; password: string };
    assert.equal(account.providerId, "credential");
    assert.equal(account.accountId, created.id);
    assert.notEqual(account.password, PASSWORD);

    const bad = await signIn(ctx.auth, "marta@local.test", "otra-clave-cualquiera");
    assert.notEqual(bad.status, 200);
    const ok = await signIn(ctx.auth, "MARTA@local.test", PASSWORD);
    assert.equal(ok.status, 200);
    const user = await sessionUserWith(ctx.auth, new Headers({ cookie: cookieOf(ok) }));
    assert.equal(user?.app_metadata.role, "admin");
    assert.equal(user?.app_metadata.staff_role, "gerente");
    assert.equal(user?.app_metadata.legal_version, undefined);
    assert.deepEqual(JSON.parse(user?.app_metadata.permissions ?? "null"), { catalogo: "view" });
  });

  it("email repetido (sin distinguir mayúsculas): conflicto y no deja filas a medias", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin", { email: "dueno@local.test" });
    const first = await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), { name: "A", email: "a@local.test", password: PASSWORD, staffRole: "cajero" });
    assert.ok(first.ok);
    for (const email of ["a@local.test", "A@LOCAL.TEST", "dueno@local.test"]) {
      const dup = await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), { name: "B", email, password: PASSWORD, staffRole: "cajero" });
      assert.deepEqual(dup, { ok: false, status: 409, error: "Ya existe un usuario con ese email." }, email);
    }
    const users = ctx.db.raw.prepare(`SELECT count(*) AS n FROM "user"`).get() as { n: number };
    const accounts = ctx.db.raw.prepare(`SELECT count(*) AS n FROM "account"`).get() as { n: number };
    assert.equal(users.n, 2);
    assert.equal(accounts.n, 1);
  });

  it("el dueño no guarda ajustes de permisos; un no dueño no puede quedar sin ninguna sección", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    const owner2 = expectOk(await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), {
      name: "Socio", email: "socio@local.test", password: PASSWORD, staffRole: "admin", permissions: { pedidos: "none" },
    }));
    assert.equal(row(ctx, owner2.id).permissions, null);
    assert.equal(owner2.permissions.pedidos, "edit");

    const none = await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), {
      name: "Nadie", email: "nadie@local.test", password: PASSWORD, staffRole: "cajero",
      permissions: { dashboard: "none", pedidos: "none", catalogo: "none", comunicacion: "none", zonas: "none", configuracion: "none" },
    });
    assert.deepEqual(none, { ok: false, status: 400, error: "Tiene que tener acceso al menos a una sección." });
  });

  it("solo staff puede usar la capa: un cliente o un anónimo recibe Forbidden", async () => {
    const ctx = setup();
    const input = { name: "X", email: "x@local.test", password: PASSWORD, staffRole: "cajero" as const };
    await assert.rejects(createStaffUser(ctx.db, ctx.auth, { kind: "cliente", userId: "c" }, input), ForbiddenError);
    await assert.rejects(createStaffUser(ctx.db, ctx.auth, { kind: "anon" }, input), ForbiddenError);
    await assert.rejects(listStaffUsers(ctx.db, { kind: "repartidor", userId: "r" }), ForbiddenError);
    await assert.rejects(updateStaffUser(ctx.db, ctx.auth, { kind: "cliente", userId: "c" }, "x", { name: "Y" }), ForbiddenError);
  });
});

describe("listado", () => {
  it("separa personal y repartidores; clientes fuera; permisos resueltos; sin datos sensibles", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    insertUser(ctx, "legacy", "admin", null);
    insertUser(ctx, "cli", "cliente", null);
    await createCourierUserWith(ctx.db, "Juan");
    expectOk(await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), { name: "Caja", email: "caja@local.test", password: PASSWORD, staffRole: "cajero" }));

    const { staff, couriers } = await listStaffUsers(ctx.db, asAdmin("dueno"));
    assert.deepEqual(staff.map((s) => s.id).sort(), [staff.find((s) => s.name === "Caja")!.id, "dueno", "legacy"].sort());
    assert.equal(staff.find((s) => s.id === "legacy")?.staffRole, "admin", "admin anterior a la migración = dueño");
    assert.equal(staff.find((s) => s.name === "Caja")?.permissions.zonas, "none");
    assert.equal(couriers.length, 1);
    assert.equal(couriers[0].name, "Juan");
    assert.deepEqual(Object.keys(couriers[0]).sort(), ["banned", "createdAt", "id", "name"], "sin el email sintético");
    assert.ok(!JSON.stringify(staff).includes("password"));
  });
});

describe("edición", () => {
  async function withGerente() {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    const g = expectOk(await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), {
      name: "Gerardo", email: "g@local.test", password: PASSWORD, staffRole: "gerente",
    }));
    const login = await signIn(ctx.auth, "g@local.test", PASSWORD);
    assert.equal(login.status, 200);
    return { ctx, g, headers: new Headers({ cookie: cookieOf(login) }) };
  }

  it("cambiar solo el nombre no cierra la sesión", async () => {
    const { ctx, g, headers } = await withGerente();
    const r = expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { name: "Gerardo P." }));
    assert.equal(r.name, "Gerardo P.");
    assert.equal(sessionCount(ctx, g.id), 1);
    assert.ok(await sessionUserWith(ctx.auth, headers));
  });

  it("permisos: se guardan como diferencia, se aplican en el próximo pedido y cortan la sesión", async () => {
    const { ctx, g, headers } = await withGerente();
    const r = expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { permissions: { ...g.permissions, configuracion: "edit", zonas: "none" } }));
    assert.equal(r.permissions.configuracion, "edit");
    assert.equal(r.permissions.zonas, "none");
    assert.deepEqual(JSON.parse(row(ctx, g.id).permissions ?? "null"), { configuracion: "edit", zonas: "none" });
    assert.equal(sessionCount(ctx, g.id), 0, "sesiones cortadas");
    assert.equal(await sessionUserWith(ctx.auth, headers), null);
    // volver a los defaults deja la columna en NULL
    expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { permissions: { configuracion: "view", zonas: "edit" } }));
    assert.equal(row(ctx, g.id).permissions, null);
  });

  it("cambiar el rol sin mandar permisos descarta los ajustes anteriores; a dueño, también", async () => {
    const { ctx, g } = await withGerente();
    expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { permissions: { ...g.permissions, catalogo: "none" } }));
    assert.notEqual(row(ctx, g.id).permissions, null);
    const asCajero = expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { staffRole: "cajero" }));
    assert.equal(asCajero.staffRole, "cajero");
    assert.equal(row(ctx, g.id).permissions, null);
    assert.equal(asCajero.permissions.catalogo, "view", "defaults del cajero");
    const asOwner = expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { staffRole: "admin", permissions: { pedidos: "none" } }));
    assert.equal(asOwner.permissions.pedidos, "edit");
    assert.equal(row(ctx, g.id).permissions, null);
  });

  it("no deja sin ninguna sección a quien no es dueño", async () => {
    const { ctx, g } = await withGerente();
    const none = Object.fromEntries(Object.keys(g.permissions).map((s) => [s, "none"]));
    assert.deepEqual(
      await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { permissions: none }),
      { ok: false, status: 400, error: "Tiene que tener acceso al menos a una sección." },
    );
  });

  it("bloquear: no entra más y se cortan las sesiones; desbloquear lo habilita", async () => {
    const { ctx, g, headers } = await withGerente();
    const banned = expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { banned: true }));
    assert.equal(banned.banned, true);
    assert.equal(sessionCount(ctx, g.id), 0);
    assert.equal(await sessionUserWith(ctx.auth, headers), null);
    const blockedLogin = await signIn(ctx.auth, "g@local.test", PASSWORD);
    const sessionAfter = blockedLogin.status === 200 ? await sessionUserWith(ctx.auth, new Headers({ cookie: cookieOf(blockedLogin) })) : null;
    assert.equal(sessionAfter, null, "aunque Better Auth abra sesión, la app no la reconoce");
    expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { banned: false }));
    const again = await signIn(ctx.auth, "g@local.test", PASSWORD);
    assert.ok(await sessionUserWith(ctx.auth, new Headers({ cookie: cookieOf(again) })));
  });

  it("restablecer contraseña: la vieja deja de servir, la nueva sirve y se cortan las sesiones", async () => {
    const { ctx, g, headers } = await withGerente();
    expectOk(await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), g.id, { password: "contrasena-nueva-99" }));
    assert.equal(await sessionUserWith(ctx.auth, headers), null);
    assert.notEqual((await signIn(ctx.auth, "g@local.test", PASSWORD)).status, 200);
    const fresh = await signIn(ctx.auth, "g@local.test", "contrasena-nueva-99");
    assert.equal(fresh.status, 200);
    const accounts = ctx.db.raw.prepare(`SELECT count(*) AS n FROM "account" WHERE userId = ?`).get(g.id) as { n: number };
    assert.equal(accounts.n, 1, "no duplica la cuenta");
  });
});

describe("protecciones", () => {
  it("repartidores: no se tocan desde acá; clientes y ids inexistentes: no encontrado", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    insertUser(ctx, "cli", "cliente", null);
    const courier = await createCourierUserWith(ctx.db, "Juan");
    assert.deepEqual(
      await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), courier, { banned: true }),
      { ok: false, status: 400, error: "Los repartidores se gestionan en Pedidos > Repartidores." },
    );
    assert.equal(row(ctx, courier).banned, 0);
    assert.equal((await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), "cli", { name: "Y" })).ok, false);
    assert.equal((await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), "cli", { name: "Y" }) as { status: number }).status, 404);
    assert.equal((await updateStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), "no-existe", { name: "Y" }) as { status: number }).status, 404);
    assert.equal(row(ctx, "cli").role, "cliente", "no se promueve a nadie");
  });

  it("uno mismo: solo el nombre (ni rol, ni bloqueo, ni contraseña)", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    insertUser(ctx, "socio", "admin", "admin");
    const me = asAdmin("dueno");
    for (const patch of [{ staffRole: "gerente" as const }, { banned: true }, { password: "otra-clave-larga-1" }]) {
      const r = await updateStaffUser(ctx.db, ctx.auth, me, "dueno", patch);
      assert.equal(r.ok, false, JSON.stringify(patch));
      assert.equal((r as { status: number }).status, 400);
    }
    assert.deepEqual({ r: row(ctx, "dueno").staff_role, b: row(ctx, "dueno").banned }, { r: "admin", b: 0 });
    assert.equal(expectOk(await updateStaffUser(ctx.db, ctx.auth, me, "dueno", { name: "Dueña" })).name, "Dueña");
    // mandar el mismo rol no es un cambio
    assert.ok((await updateStaffUser(ctx.db, ctx.auth, me, "dueno", { staffRole: "admin", banned: false })).ok);
  });

  it("nunca queda el sistema sin un dueño activo", async () => {
    const ctx = setup();
    insertUser(ctx, "a", "admin", "admin");
    insertUser(ctx, "b", "admin", "admin");
    // a degrada a b: queda a
    assert.ok((await updateStaffUser(ctx.db, ctx.auth, asAdmin("a"), "b", { staffRole: "gerente" })).ok);
    // ahora a es el único dueño: nadie (ni el sistema) puede degradarlo ni bloquearlo
    for (const patch of [{ staffRole: "cajero" as const }, { banned: true }]) {
      const r = await updateStaffUser(ctx.db, ctx.auth, system, "a", patch);
      assert.deepEqual(r, { ok: false, status: 409, error: "Tiene que quedar al menos un usuario dueño activo." });
    }
    assert.deepEqual({ r: row(ctx, "a").staff_role, b: row(ctx, "a").banned }, { r: "admin", b: 0 });
  });

  it("un dueño bloqueado no cuenta como activo", async () => {
    const ctx = setup();
    insertUser(ctx, "a", "admin", "admin");
    insertUser(ctx, "b", "admin", "admin", { banned: 1 });
    const r = await updateStaffUser(ctx.db, ctx.auth, system, "a", { staffRole: "gerente" });
    assert.equal((r as { status: number }).status, 409);
    // y se puede desbloquear a b, tras lo cual a sí se puede degradar
    assert.ok((await updateStaffUser(ctx.db, ctx.auth, system, "b", { banned: false })).ok);
    assert.ok((await updateStaffUser(ctx.db, ctx.auth, system, "a", { staffRole: "gerente" })).ok);
  });

  it("un admin anterior a la migración (staff_role NULL) cuenta como dueño activo", async () => {
    const ctx = setup();
    insertUser(ctx, "viejo", "admin", null);
    insertUser(ctx, "nuevo", "admin", "admin");
    assert.ok((await updateStaffUser(ctx.db, ctx.auth, system, "nuevo", { staffRole: "gerente" })).ok, "queda 'viejo'");
    const r = await updateStaffUser(ctx.db, ctx.auth, system, "viejo", { banned: true });
    assert.equal((r as { status: number }).status, 409);
  });

  it("dos degradaciones simultáneas: solo una se aplica (la condición va dentro del UPDATE)", async () => {
    const ctx = setup();
    insertUser(ctx, "a", "admin", "admin");
    insertUser(ctx, "b", "admin", "admin");
    const results = await Promise.all([
      updateStaffUser(ctx.db, ctx.auth, system, "a", { staffRole: "cajero" }),
      updateStaffUser(ctx.db, ctx.auth, system, "b", { staffRole: "cajero" }),
    ]);
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    const owners = ctx.db.raw.prepare(`SELECT count(*) AS n FROM "user" WHERE role = 'admin' AND COALESCE(staff_role, 'admin') = 'admin' AND banned = 0`).get() as { n: number };
    assert.equal(owners.n, 1);
  });
});

describe("toSessionUser con staff_role", () => {
  it("solo los usuarios con rol admin llevan staff_role; sin dato = dueño", () => {
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "admin" })?.app_metadata.staff_role, "admin");
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "admin", staff_role: "cajero", permissions: '{"zonas":"view"}' })?.app_metadata.permissions, '{"zonas":"view"}');
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "cliente", staff_role: "admin" })?.app_metadata.staff_role, undefined, "un cliente no hereda staff_role");
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "admin", staff_role: "superusuario" })?.app_metadata.staff_role, "cajero", "valor desconocido: el más restringido");
  });

  it("el usuario no puede auto-otorgarse staff_role ni permissions por update-user", async () => {
    const ctx = setup();
    insertUser(ctx, "dueno", "admin", "admin");
    const created = expectOk(await createStaffUser(ctx.db, ctx.auth, asAdmin("dueno"), { name: "C", email: "c@local.test", password: PASSWORD, staffRole: "cajero" }));
    const login = await signIn(ctx.auth, "c@local.test", PASSWORD);
    await ctx.auth.handler(new Request(`${BASE}/api/auth/update-user`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, cookie: cookieOf(login) },
      body: JSON.stringify({ staff_role: "admin", permissions: '{"zonas":"edit"}', role: "admin" }),
    }));
    assert.deepEqual({ s: row(ctx, created.id).staff_role, p: row(ctx, created.id).permissions }, { s: "cajero", p: null });
  });
});
