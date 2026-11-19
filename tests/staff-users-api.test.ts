/**
 * Lógica de /api/admin/usuarios: solo el dueño, validación del cuerpo (zod), códigos HTTP y contrato de la respuesta.
 * Corre contra la capa de datos real sobre node:sqlite (la ruta de Next solo agrega sesión, CSRF y límite).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth } from "../src/lib/data/auth.ts";
import { createCourierUserWith } from "../src/lib/data/session.ts";
import type { Actor } from "../src/lib/data/actor.ts";
import { createStaffUser, listStaffUsers, updateStaffUser } from "../src/lib/data/staff-users.ts";

const { staffAccessOf } = await import("../src/lib/auth/permissions.ts");
const { createStaffUserApi, listStaffUsersApi, updateStaffUserApi } = await import("../src/lib/staff-users/api.ts");
import type { StaffUsersPort } from "../src/lib/staff-users/api.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const owner = staffAccessOf({ staff_role: "admin" });
const gerente = staffAccessOf({ staff_role: "gerente" });
const cajero = staffAccessOf({ staff_role: "cajero" });
const asAdmin = (userId: string): Actor => ({ kind: "admin", userId });

function setup() {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: crypto.randomUUID() + crypto.randomUUID(), baseURL: BASE });
  const now = new Date().toISOString();
  const insert = db.raw.prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'admin', ?, ?, ?)`);
  insert.run("dueno", "Dueña", "dueno@local.test", "admin", now, now);
  const port: StaffUsersPort<Actor> = {
    list: (actor) => listStaffUsers(db, actor),
    create: (actor, input) => createStaffUser(db, auth, actor, input),
    update: (actor, id, patch) => updateStaffUser(db, auth, actor, id, patch),
  };
  return { db, port, actor: asAdmin("dueno") };
}

const valid = { name: "Rodri", email: "rodri@local.test", password: "clave-segura-123", staff_role: "cajero" };

describe("solo el dueño (403)", () => {
  it("gerente y cajero no listan, crean ni editan", async () => {
    const { port, actor } = setup();
    for (const access of [gerente, cajero]) {
      assert.equal((await listStaffUsersApi(port, access, actor, "x")).status, 403);
      assert.equal((await createStaffUserApi(port, access, actor, valid)).status, 403);
      assert.equal((await updateStaffUserApi(port, access, actor, "dueno", { name: "Y" })).status, 403);
    }
  });

  it("el rechazo es previo a la validación: no filtra si el cuerpo es válido", async () => {
    const { port, actor, db } = setup();
    assert.equal((await createStaffUserApi(port, cajero, actor, { basura: true })).status, 403);
    const n = db.raw.prepare(`SELECT count(*) AS n FROM "user"`).get() as { n: number };
    assert.equal(n.n, 1, "no se creó nada");
  });
});

describe("POST: crear", () => {
  it("201, email normalizado y la respuesta no trae contraseña ni hash", async () => {
    const { port, actor } = setup();
    const r = await createStaffUserApi(port, owner, actor, { ...valid, email: "Rodri@Local.TEST" });
    assert.equal(r.status, 201);
    const user = (r.body as { user: Record<string, unknown> }).user;
    assert.equal(user.email, "rodri@local.test");
    assert.equal(user.staff_role, "cajero");
    assert.deepEqual(Object.keys(user).sort(), ["banned", "createdAt", "email", "id", "name", "permissions", "staff_role"]);
    assert.ok(!JSON.stringify(r.body).includes(valid.password));
    assert.equal((user.permissions as Record<string, string>).pedidos, "edit");
  });

  it("acepta permisos parciales sobre el rol", async () => {
    const { port, actor } = setup();
    const r = await createStaffUserApi(port, owner, actor, { ...valid, staff_role: "gerente", permissions: { configuracion: "edit" } });
    assert.equal(r.status, 201);
    assert.equal(((r.body as { user: { permissions: Record<string, string> } }).user).permissions.configuracion, "edit");
  });

  it("email duplicado: 409", async () => {
    const { port, actor } = setup();
    assert.equal((await createStaffUserApi(port, owner, actor, valid)).status, 201);
    const dup = await createStaffUserApi(port, owner, actor, { ...valid, name: "Otro", email: "RODRI@local.test" });
    assert.deepEqual(dup, { status: 409, body: { error: "Ya existe un usuario con ese email." } });
    const sameAsOwner = await createStaffUserApi(port, owner, actor, { ...valid, email: "dueno@local.test" });
    assert.equal(sameAsOwner.status, 409);
  });

  it("validación: 400 con mensaje en español", async () => {
    const { port, actor } = setup();
    const cases: Array<[string, unknown]> = [
      ["cuerpo vacío", null],
      ["no es objeto", "hola"],
      ["sin nombre", { ...valid, name: "   " }],
      ["email inválido", { ...valid, email: "no-es-email" }],
      ["contraseña corta (9)", { ...valid, password: "123456789" }],
      ["contraseña larguísima", { ...valid, password: "x".repeat(129) }],
      ["rol inválido", { ...valid, staff_role: "superadmin" }],
      ["sin rol", { name: valid.name, email: valid.email, password: valid.password }],
      ["sección inexistente", { ...valid, permissions: { inventada: "edit" } }],
      ["nivel inválido", { ...valid, permissions: { pedidos: "todo" } }],
      ["campo de más (role)", { ...valid, role: "admin" }],
      ["campo de más (banned)", { ...valid, banned: false }],
    ];
    for (const [label, body] of cases) {
      const r = await createStaffUserApi(port, owner, actor, body);
      assert.equal(r.status, 400, label);
      assert.equal(typeof (r.body as { error: unknown }).error, "string", label);
    }
    assert.equal(((await createStaffUserApi(port, owner, actor, { ...valid, password: "123456789" })).body as { error: string }).error, "La contraseña tiene que tener al menos 10 caracteres.");
    // con 10 sí alcanza
    assert.equal((await createStaffUserApi(port, owner, actor, { ...valid, password: "1234567890" })).status, 201);
  });

  it("un gerente o cajero sin ninguna sección: 400", async () => {
    const { port, actor } = setup();
    const none = { dashboard: "none", pedidos: "none", catalogo: "none", comunicacion: "none", zonas: "none", configuracion: "none" };
    const r = await createStaffUserApi(port, owner, actor, { ...valid, permissions: none });
    assert.deepEqual(r, { status: 400, body: { error: "Tiene que tener acceso al menos a una sección." } });
  });
});

describe("GET: listar", () => {
  it("personal con permisos resueltos, repartidores aparte y quién consulta", async () => {
    const { port, actor, db } = setup();
    await createStaffUserApi(port, owner, actor, valid);
    await createCourierUserWith(db, "Juan");
    const r = await listStaffUsersApi(port, owner, actor, "dueno");
    assert.equal(r.status, 200);
    const body = r.body as { users: Array<{ email: string; staff_role: string; permissions: Record<string, string> }>; couriers: Array<{ name: string }>; currentUserId: string };
    assert.equal(body.currentUserId, "dueno");
    assert.deepEqual(body.users.map((u) => u.staff_role).sort(), ["admin", "cajero"]);
    assert.ok(body.users.every((u) => Object.keys(u.permissions).length === 6));
    assert.deepEqual(body.couriers.map((c) => c.name), ["Juan"]);
  });
});

describe("PATCH: editar", () => {
  it("200 con el usuario actualizado", async () => {
    const { port, actor } = setup();
    const created = (await createStaffUserApi(port, owner, actor, valid)).body as { user: { id: string } };
    const r = await updateStaffUserApi(port, owner, actor, created.user.id, { staff_role: "gerente", name: "Rodrigo" });
    assert.equal(r.status, 200);
    const user = (r.body as { user: { name: string; staff_role: string; permissions: Record<string, string> } }).user;
    assert.equal(user.name, "Rodrigo");
    assert.equal(user.staff_role, "gerente");
    assert.equal(user.permissions.comunicacion, "edit");
  });

  it("validación: id inválido, cuerpo vacío, campos desconocidos y valores inválidos son 400", async () => {
    const { port, actor } = setup();
    assert.equal((await updateStaffUserApi(port, owner, actor, "../etc/passwd", { name: "X" })).status, 400);
    assert.equal((await updateStaffUserApi(port, owner, actor, "x".repeat(65), { name: "X" })).status, 400);
    for (const body of [null, {}, { role: "admin" }, { staff_role: "dios" }, { banned: "si" }, { password: "corta" }, { permissions: { pedidos: "x" } }, { name: "" }]) {
      const r = await updateStaffUserApi(port, owner, actor, "dueno", body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(await updateStaffUserApi(port, owner, actor, "dueno", {}), { status: 400, body: { error: "No hay cambios para guardar." } });
  });

  it("no se puede tocar a un repartidor", async () => {
    const { port, actor, db } = setup();
    const courier = await createCourierUserWith(db, "Juan");
    const r = await updateStaffUserApi(port, owner, actor, courier, { banned: true });
    assert.deepEqual(r, { status: 400, body: { error: "Los repartidores se gestionan en Pedidos > Repartidores." } });
    const row = db.raw.prepare(`SELECT banned FROM "user" WHERE id = ?`).get(courier) as { banned: number };
    assert.equal(row.banned, 0);
  });

  it("no se puede quitar el rol de dueño ni bloquear a uno mismo (400)", async () => {
    const { port, actor } = setup();
    assert.equal((await updateStaffUserApi(port, owner, actor, "dueno", { staff_role: "cajero" })).status, 400);
    assert.equal((await updateStaffUserApi(port, owner, actor, "dueno", { banned: true })).status, 400);
    assert.equal((await updateStaffUserApi(port, owner, actor, "dueno", { name: "Nueva" })).status, 200);
  });

  it("no se puede dejar al sistema sin dueño activo (409); con dos dueños sí", async () => {
    const { port, actor } = setup();
    const socio = ((await createStaffUserApi(port, owner, actor, { ...valid, staff_role: "admin" })).body as { user: { id: string } }).user.id;
    // con dos dueños se puede degradar a uno: queda "dueno"
    assert.equal((await updateStaffUserApi(port, owner, actor, socio, { staff_role: "gerente" })).status, 200);
    // ahora "dueno" es el único dueño activo: otro actor (no es él mismo) tampoco puede degradarlo
    const r = await updateStaffUserApi(port, owner, { kind: "system", reason: "test" }, "dueno", { staff_role: "cajero" });
    assert.deepEqual(r, { status: 409, body: { error: "Tiene que quedar al menos un usuario dueño activo." } });
  });

  it("usuario inexistente: 404", async () => {
    const { port, actor } = setup();
    assert.equal((await updateStaffUserApi(port, owner, actor, "nadie", { name: "X" })).status, 404);
  });
});
