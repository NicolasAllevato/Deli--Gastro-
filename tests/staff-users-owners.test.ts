/**
 * Dueño principal (SUPER_OWNER_EMAIL) y reglas entre dueños sobre el esquema real de D1 y Better Auth:
 * solo el principal edita a otros dueños y crea dueños, cada dueño cambia su nombre y su contraseña (con la actual),
 * el principal no se bloquea ni se degrada, y sin la variable el comportamiento es el seguro.
 * Todos los emails son ficticios.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth } from "../src/lib/data/auth.ts";
import { sessionUserWith } from "../src/lib/data/session.ts";
import type { Actor } from "../src/lib/data/actor.ts";
import { createStaffUser, listStaffUsers, updateStaffUser, type StaffRulesOptions } from "../src/lib/data/staff-users.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const PASSWORD = "clave-segura-123";
const SUPER_EMAIL = "principal@ejemplo.test";
const WITH_SUPER: StaffRulesOptions = { superOwnerEmail: SUPER_EMAIL };
const WITHOUT_SUPER: StaffRulesOptions = { superOwnerEmail: null };

const admin = (userId: string): Actor => ({ kind: "admin", userId });
const system: Actor = { kind: "system", reason: "test" };

type Ctx = ReturnType<typeof setup>;
function setup(opts: StaffRulesOptions = WITH_SUPER) {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: crypto.randomUUID() + crypto.randomUUID(), baseURL: BASE });
  return { db, auth, opts };
}

/** Alta directa con el actor de sistema (no pasa por las reglas de dueños: arma el escenario). */
async function seedUser(ctx: Ctx, name: string, email: string, staffRole: "admin" | "gerente" | "cajero"): Promise<string> {
  const r = await createStaffUser(ctx.db, ctx.auth, system, { name, email, password: PASSWORD, staffRole }, ctx.opts);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value.id;
}

async function scenario(opts: StaffRulesOptions = WITH_SUPER) {
  const ctx = setup(opts);
  const superId = await seedUser(ctx, "Principal", SUPER_EMAIL, "admin");
  const socioId = await seedUser(ctx, "Socio", "socio@ejemplo.test", "admin");
  const gerenteId = await seedUser(ctx, "Gerente", "gerente@ejemplo.test", "gerente");
  const cajeroId = await seedUser(ctx, "Cajero", "cajero@ejemplo.test", "cajero");
  return { ctx, superId, socioId, gerenteId, cajeroId };
}

const update = (ctx: Ctx, actor: Actor, id: string, patch: Parameters<typeof updateStaffUser>[4]) =>
  updateStaffUser(ctx.db, ctx.auth, actor, id, patch, ctx.opts);
const create = (ctx: Ctx, actor: Actor, staffRole: "admin" | "gerente" | "cajero", email: string) =>
  createStaffUser(ctx.db, ctx.auth, actor, { name: "Nuevo", email, password: PASSWORD, staffRole }, ctx.opts);
const status = (r: { ok: true } | { ok: false; status: number }) => (r.ok ? 200 : r.status);

let ip = 0;
const signIn = (ctx: Ctx, email: string, password: string) =>
  ctx.auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": `10.7.0.${++ip}` },
    body: JSON.stringify({ email, password }),
  }));
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const sessionCount = (ctx: Ctx, id: string) => (ctx.db.raw.prepare(`SELECT count(*) AS n FROM "session" WHERE userId = ?`).get(id) as { n: number }).n;
const rowOf = (ctx: Ctx, id: string) => ctx.db.raw.prepare(`SELECT name, staff_role, banned FROM "user" WHERE id = ?`).get(id) as { name: string; staff_role: string; banned: number };

describe("alta: solo el principal crea dueños", () => {
  it("el principal crea un dueño; otro dueño no (403); gerentes y cajeros los crean todos los dueños", async () => {
    const { ctx, superId, socioId } = await scenario();
    assert.equal(status(await create(ctx, admin(superId), "admin", "nuevo-dueno@ejemplo.test")), 200);
    const denied = await create(ctx, admin(socioId), "admin", "otro-dueno@ejemplo.test");
    assert.equal(status(denied), 403);
    assert.match((denied as { error: string }).error, /dueño principal/);
    assert.equal(status(await create(ctx, admin(socioId), "gerente", "g2@ejemplo.test")), 200);
    assert.equal(status(await create(ctx, admin(socioId), "cajero", "c2@ejemplo.test")), 200);
    assert.equal(status(await create(ctx, admin(superId), "cajero", "c3@ejemplo.test")), 200);
    const n = ctx.db.raw.prepare(`SELECT count(*) AS n FROM "user" WHERE email = 'otro-dueno@ejemplo.test'`).get() as { n: number };
    assert.equal(n.n, 0, "no quedó creado");
  });

  it("un gerente (aunque llegue a la capa de datos) no crea nada", async () => {
    const { ctx, gerenteId } = await scenario();
    assert.equal(status(await create(ctx, admin(gerenteId), "cajero", "x@ejemplo.test")), 403);
  });

  it("un dueño bloqueado pierde sus facultades", async () => {
    const { ctx, superId, socioId } = await scenario();
    assert.ok((await update(ctx, admin(superId), socioId, { banned: true })).ok);
    assert.equal(status(await create(ctx, admin(socioId), "cajero", "x@ejemplo.test")), 403);
  });
});

describe("edición entre dueños", () => {
  it("otro dueño no puede editar a un dueño: nombre, rol, permisos, bloqueo ni contraseña (403)", async () => {
    const { ctx, superId, socioId } = await scenario();
    const patches = [{ name: "Hackeado" }, { staffRole: "gerente" as const }, { banned: true }, { password: "otra-clave-larga-1" }];
    // un tercer dueño intenta editar al socio y al principal
    const tercero = await seedUser(ctx, "Tercero", "tercero@ejemplo.test", "admin");
    for (const target of [socioId, superId]) {
      for (const patch of patches) {
        assert.equal(status(await update(ctx, admin(tercero), target, patch)), 403, `${target} ${JSON.stringify(patch)}`);
      }
    }
    assert.equal(rowOf(ctx, socioId).name, "Socio");
    assert.equal((await signIn(ctx, "socio@ejemplo.test", PASSWORD)).status, 200, "su contraseña sigue igual");
  });

  it("el principal edita a otro dueño: lo renombra, lo degrada, lo bloquea y le restablece la contraseña", async () => {
    const { ctx, superId, socioId } = await scenario();
    assert.ok((await update(ctx, admin(superId), socioId, { name: "Socia" })).ok);
    assert.equal(rowOf(ctx, socioId).name, "Socia");
    assert.ok((await update(ctx, admin(superId), socioId, { password: "clave-nueva-del-socio" })).ok);
    assert.equal((await signIn(ctx, "socio@ejemplo.test", "clave-nueva-del-socio")).status, 200);
    assert.ok((await update(ctx, admin(superId), socioId, { banned: true })).ok);
    assert.ok((await update(ctx, admin(superId), socioId, { banned: false })).ok);
    assert.ok((await update(ctx, admin(superId), socioId, { staffRole: "gerente" })).ok);
    assert.equal(rowOf(ctx, socioId).staff_role, "gerente");
  });

  it("solo el principal promueve a dueño", async () => {
    const { ctx, superId, socioId, gerenteId, cajeroId } = await scenario();
    assert.equal(status(await update(ctx, admin(socioId), gerenteId, { staffRole: "admin" })), 403);
    assert.equal(rowOf(ctx, gerenteId).staff_role, "gerente");
    assert.equal(status(await update(ctx, admin(superId), gerenteId, { staffRole: "admin" })), 200);
    assert.equal(rowOf(ctx, gerenteId).staff_role, "admin");
    // cualquier dueño edita gerentes y cajeros
    assert.equal(status(await update(ctx, admin(socioId), cajeroId, { staffRole: "gerente", name: "Cajero A" })), 200);
    assert.equal(status(await update(ctx, admin(socioId), cajeroId, { banned: true })), 200);
  });
});

describe("el dueño principal es intocable", () => {
  it("ni él mismo, ni otro dueño, ni el sistema lo bloquean o degradan (403)", async () => {
    const { ctx, superId, socioId } = await scenario();
    for (const actor of [admin(superId), admin(socioId), system]) {
      assert.equal(status(await update(ctx, actor, superId, { banned: true })), 403);
      assert.equal(status(await update(ctx, actor, superId, { staffRole: "gerente" })), 403);
    }
    assert.deepEqual({ ...rowOf(ctx, superId) }, { name: "Principal", staff_role: "admin", banned: 0 });
  });

  it("puede cambiar su nombre y su contraseña (con la actual)", async () => {
    const { ctx, superId } = await scenario();
    assert.ok((await update(ctx, admin(superId), superId, { name: "Principal P." })).ok);
    assert.equal(status(await update(ctx, admin(superId), superId, { password: "clave-nueva-1234" })), 400, "falta la actual");
    assert.ok((await update(ctx, admin(superId), superId, { password: "clave-nueva-1234", currentPassword: PASSWORD })).ok);
    assert.equal((await signIn(ctx, SUPER_EMAIL, "clave-nueva-1234")).status, 200);
  });

  it("un gerente con el mismo email que el principal no hereda nada: no es dueño ni intocable", async () => {
    const ctx = setup(WITH_SUPER);
    const owner = await seedUser(ctx, "Otro dueño", "dueno-comun@ejemplo.test", "admin");
    // el email del principal pertenece a un gerente (p. ej. se cargó mal): no cuenta como principal
    const impostor = await seedUser(ctx, "Impostor", SUPER_EMAIL, "gerente");
    assert.equal(status(await update(ctx, system, impostor, { banned: true })), 200);
    assert.equal(status(await update(ctx, admin(impostor), owner, { name: "X" })), 403);
    const list = await listStaffUsers(ctx.db, system, WITH_SUPER);
    assert.equal(list.staff.find((u) => u.id === impostor)?.isSuperOwner, false);
  });
});

describe("dueño común sobre sí mismo", () => {
  it("cambia su nombre; no su rol ni se bloquea (400)", async () => {
    const { ctx, socioId } = await scenario();
    assert.ok((await update(ctx, admin(socioId), socioId, { name: "Socia B" })).ok);
    assert.equal(rowOf(ctx, socioId).name, "Socia B");
    assert.equal(status(await update(ctx, admin(socioId), socioId, { staffRole: "gerente" })), 400);
    assert.equal(status(await update(ctx, admin(socioId), socioId, { banned: true })), 400);
    assert.deepEqual({ r: rowOf(ctx, socioId).staff_role, b: rowOf(ctx, socioId).banned }, { r: "admin", b: 0 });
  });

  it("cambia su contraseña solo con la actual: sin ella o con otra, 400; con la correcta, entra con la nueva y se cierran sus sesiones", async () => {
    const { ctx, socioId } = await scenario();
    const login = await signIn(ctx, "socio@ejemplo.test", PASSWORD);
    assert.equal(login.status, 200);
    const headers = new Headers({ cookie: cookieOf(login) });
    assert.ok(await sessionUserWith(ctx.auth, headers));

    const noCurrent = await update(ctx, admin(socioId), socioId, { password: "clave-nueva-socio-1" });
    assert.deepEqual(noCurrent, { ok: false, status: 400, error: "La contraseña actual no es correcta." });
    const wrong = await update(ctx, admin(socioId), socioId, { password: "clave-nueva-socio-1", currentPassword: "no-es-esta-clave-1" });
    assert.equal(status(wrong), 400);
    assert.equal(sessionCount(ctx, socioId), 1, "los intentos fallidos no tocan la sesión");
    assert.equal((await signIn(ctx, "socio@ejemplo.test", PASSWORD)).status, 200, "la contraseña no cambió");

    assert.ok((await update(ctx, admin(socioId), socioId, { password: "clave-nueva-socio-1", currentPassword: PASSWORD })).ok);
    assert.equal(await sessionUserWith(ctx.auth, headers), null, "sesiones cerradas");
    assert.notEqual((await signIn(ctx, "socio@ejemplo.test", PASSWORD)).status, 200);
    assert.equal((await signIn(ctx, "socio@ejemplo.test", "clave-nueva-socio-1")).status, 200);
  });

  it("la contraseña actual no se exige al restablecer la de otro usuario", async () => {
    const { ctx, socioId, gerenteId } = await scenario();
    assert.ok((await update(ctx, admin(socioId), gerenteId, { password: "clave-del-gerente-9" })).ok);
    assert.equal((await signIn(ctx, "gerente@ejemplo.test", "clave-del-gerente-9")).status, 200);
  });
});

describe("sin SUPER_OWNER_EMAIL (modo seguro)", () => {
  it("nadie edita a otro dueño ni crea dueños; cada dueño se edita a sí mismo y gestiona gerentes y cajeros", async () => {
    const { ctx, superId, socioId, gerenteId } = await scenario(WITHOUT_SUPER);
    assert.equal(status(await update(ctx, admin(superId), socioId, { name: "X" })), 403);
    assert.equal(status(await update(ctx, admin(socioId), superId, { banned: true })), 403);
    assert.equal(status(await create(ctx, admin(superId), "admin", "nuevo@ejemplo.test")), 403);
    assert.equal(status(await update(ctx, admin(socioId), gerenteId, { staffRole: "admin" })), 403);

    assert.equal(status(await update(ctx, admin(socioId), socioId, { name: "Socia C" })), 200);
    assert.equal(status(await update(ctx, admin(socioId), socioId, { staffRole: "gerente" })), 400);
    assert.equal(status(await update(ctx, admin(superId), gerenteId, { name: "G" })), 200);
    assert.equal(status(await create(ctx, admin(socioId), "cajero", "c@ejemplo.test")), 200);
  });

  it("el listado no deja editar a otros dueños y avisa que no hay dueño principal", async () => {
    const { ctx, superId, socioId, gerenteId } = await scenario(WITHOUT_SUPER);
    const list = await listStaffUsers(ctx.db, admin(socioId), WITHOUT_SUPER);
    assert.deepEqual(list.viewer, { isSuperOwner: false, superOwnerConfigured: false });
    const can = Object.fromEntries(list.staff.map((u) => [u.id, u.canEdit]));
    assert.equal(can[socioId], true, "sí a sí mismo");
    assert.equal(can[superId], false);
    assert.equal(can[gerenteId], true);
    assert.ok(list.staff.every((u) => u.isSuperOwner === false));
  });
});

describe("listado con dueño principal", () => {
  it("marca al principal y habilita la edición según quién mira", async () => {
    const { ctx, superId, socioId, gerenteId, cajeroId } = await scenario();
    const asSuper = await listStaffUsers(ctx.db, admin(superId), WITH_SUPER);
    assert.deepEqual(asSuper.viewer, { isSuperOwner: true, superOwnerConfigured: true });
    assert.deepEqual(asSuper.staff.filter((u) => u.isSuperOwner).map((u) => u.id), [superId]);
    assert.ok(asSuper.staff.every((u) => u.canEdit), "el principal ve editables a todos (incluido él)");

    const asOwner = await listStaffUsers(ctx.db, admin(socioId), WITH_SUPER);
    assert.deepEqual(asOwner.viewer, { isSuperOwner: false, superOwnerConfigured: true });
    const can = Object.fromEntries(asOwner.staff.map((u) => [u.id, u.canEdit]));
    assert.deepEqual(can, { [superId]: false, [socioId]: true, [gerenteId]: true, [cajeroId]: true });

    const asManager = await listStaffUsers(ctx.db, admin(gerenteId), WITH_SUPER);
    assert.ok(asManager.staff.every((u) => u.canEdit === false), "un gerente no gestiona usuarios");
  });

  it("la comparación del email no distingue mayúsculas", async () => {
    const { ctx, superId } = await scenario();
    const list = await listStaffUsers(ctx.db, admin(superId), { superOwnerEmail: "  PRINCIPAL@Ejemplo.TEST " });
    assert.equal(list.staff.find((u) => u.id === superId)?.isSuperOwner, true);
  });
});
