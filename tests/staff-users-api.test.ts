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

/** Dueño principal por defecto: el usuario "dueno" (emails ficticios). `null` = SUPER_OWNER_EMAIL sin configurar. */
function setup(superOwnerEmail: string | null = "dueno@local.test") {
  const opts = { superOwnerEmail };
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: crypto.randomUUID() + crypto.randomUUID(), baseURL: BASE });
  const now = new Date().toISOString();
  const insert = db.raw.prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, createdAt, updatedAt) VALUES (?, ?, ?, 1, 'admin', ?, ?, ?)`);
  insert.run("dueno", "Dueña", "dueno@local.test", "admin", now, now);
  const port: StaffUsersPort<Actor> = {
    list: (actor) => listStaffUsers(db, actor, opts),
    create: (actor, input) => createStaffUser(db, auth, actor, input, opts),
    update: (actor, id, patch) => updateStaffUser(db, auth, actor, id, patch, opts),
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
    assert.deepEqual(Object.keys(user).sort(), ["banned", "canEdit", "createdAt", "email", "id", "isSuperOwner", "name", "permissions", "staff_role"]);
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

describe("dueño principal en la API", () => {
  it("el listado trae isSuperOwner del que consulta, superOwnerConfigured y canEdit por usuario", async () => {
    const { port, actor } = setup();
    const system = { kind: "system", reason: "test" } as const;
    const socio = ((await createStaffUserApi(port, owner, system, { ...valid, staff_role: "admin" })).body as { user: { id: string } }).user.id;
    await createStaffUserApi(port, owner, actor, { ...valid, email: "caja@local.test" });

    type Listing = { isSuperOwner: boolean; superOwnerConfigured: boolean; users: Array<{ id: string; canEdit: boolean; isSuperOwner: boolean }> };
    const asSuper = (await listStaffUsersApi(port, owner, actor, "dueno")).body as Listing;
    assert.equal(asSuper.isSuperOwner, true);
    assert.equal(asSuper.superOwnerConfigured, true);
    assert.ok(asSuper.users.every((u) => u.canEdit));
    assert.deepEqual(asSuper.users.filter((u) => u.isSuperOwner).map((u) => u.id), ["dueno"]);

    const asSocio = (await listStaffUsersApi(port, owner, asAdmin(socio), socio)).body as Listing;
    assert.equal(asSocio.isSuperOwner, false);
    assert.equal(asSocio.users.find((u) => u.id === "dueno")?.canEdit, false);
    assert.equal(asSocio.users.find((u) => u.id === socio)?.canEdit, true);

    const unconfigured = setup(null);
    const none = (await listStaffUsersApi(unconfigured.port, owner, unconfigured.actor, "dueno")).body as Listing;
    assert.equal(none.superOwnerConfigured, false);
    assert.equal(none.isSuperOwner, false);
  });

  it("crear un dueño o editar a otro dueño sin ser el principal: 403 con mensaje", async () => {
    const { port, actor } = setup();
    const system = { kind: "system", reason: "test" } as const;
    const socio = ((await createStaffUserApi(port, owner, system, { ...valid, staff_role: "admin" })).body as { user: { id: string } }).user.id;
    const asSocio = asAdmin(socio);
    const create = await createStaffUserApi(port, owner, asSocio, { ...valid, email: "otro@local.test", staff_role: "admin" });
    assert.equal(create.status, 403);
    assert.match((create.body as { error: string }).error, /dueño principal/);
    assert.equal((await updateStaffUserApi(port, owner, asSocio, "dueno", { name: "X" })).status, 403);
    // el principal sí crea dueños
    assert.equal((await createStaffUserApi(port, owner, actor, { ...valid, email: "otro@local.test", staff_role: "admin" })).status, 201);
  });

  it("cambiar la propia contraseña: current_password obligatoria y correcta; sola no es un cambio", async () => {
    const { port, actor } = setup();
    const created = ((await createStaffUserApi(port, owner, actor, { ...valid, staff_role: "admin" })).body as { user: { id: string } }).user.id;
    const me = asAdmin(created);
    const body = { password: "clave-nueva-larga-1" };
    assert.deepEqual(await updateStaffUserApi(port, owner, me, created, body), { status: 400, body: { error: "La contraseña actual no es correcta." } });
    assert.equal((await updateStaffUserApi(port, owner, me, created, { ...body, current_password: "mal-la-actual-1" })).status, 400);
    assert.equal((await updateStaffUserApi(port, owner, me, created, { ...body, current_password: valid.password })).status, 200);
    assert.deepEqual(await updateStaffUserApi(port, owner, me, created, { current_password: "solo-la-actual-1" }), { status: 400, body: { error: "No hay cambios para guardar." } });
    assert.equal((await updateStaffUserApi(port, owner, me, created, { ...body, current_password: "" })).status, 400, "vacía no vale");
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

  it("el dueño principal no se degrada ni se bloquea (403, ni él mismo); un dueño común, sobre sí mismo, 400", async () => {
    const { port, actor } = setup();
    assert.equal((await updateStaffUserApi(port, owner, actor, "dueno", { staff_role: "cajero" })).status, 403);
    assert.equal((await updateStaffUserApi(port, owner, actor, "dueno", { banned: true })).status, 403);
    assert.equal((await updateStaffUserApi(port, owner, actor, "dueno", { name: "Nueva" })).status, 200);

    const socio = ((await createStaffUserApi(port, owner, actor, { ...valid, staff_role: "admin" })).body as { user: { id: string } }).user.id;
    assert.equal((await updateStaffUserApi(port, owner, asAdmin(socio), socio, { staff_role: "cajero" })).status, 400);
    assert.equal((await updateStaffUserApi(port, owner, asAdmin(socio), socio, { banned: true })).status, 400);
    assert.equal((await updateStaffUserApi(port, owner, asAdmin(socio), socio, { name: "Socia" })).status, 200);
  });

  it("no se puede dejar al sistema sin dueño activo (409); con dos dueños sí", async () => {
    const { port, actor } = setup(null); // sin dueño principal: así el último dueño no lo protege otra regla
    const system = { kind: "system", reason: "test" } as const;
    const socio = ((await createStaffUserApi(port, owner, system, { ...valid, staff_role: "admin" })).body as { user: { id: string } }).user.id;
    // con dos dueños se puede degradar a uno: queda "dueno"
    assert.equal((await updateStaffUserApi(port, owner, system, socio, { staff_role: "gerente" })).status, 200);
    // ahora "dueno" es el único dueño activo: otro actor (no es él mismo) tampoco puede degradarlo
    const r = await updateStaffUserApi(port, owner, system, "dueno", { staff_role: "cajero" });
    assert.deepEqual(r, { status: 409, body: { error: "Tiene que quedar al menos un usuario dueño activo." } });
  });

  it("usuario inexistente: 404", async () => {
    const { port, actor } = setup();
    assert.equal((await updateStaffUserApi(port, owner, actor, "nadie", { name: "X" })).status, 404);
  });
});
