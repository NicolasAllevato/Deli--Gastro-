/**
 * Eliminación de usuarios de la app (personal del panel) sobre D1 real (node:sqlite) y Better Auth real: solo se borra la cuenta de
 * acceso, el historial no se toca, código de un solo uso (HMAC) + contraseña + email exacto, secreto obligatorio, protecciones
 * (dueño principal, último dueño) y autoservicio con contraseña y tope de intentos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import "./helpers/alias.ts";
import type { Actor } from "../src/lib/data/actor.ts";
import {
  DELETION_STEPS, KEPT, MESSAGES, SELF_MESSAGES, TOKEN_TTL_MS, deleteOwnAccount, deleteUserAsOwner, issueToken, listDeletableUsers,
  listDeletionRequests, ownAccountEligibility, previewUserDeletion, readToken, subjectHash, type DeletionOutcome, type DeletionOptions,
} from "../src/lib/data/data-deletion.ts";
import { BASE, PASSWORD, SECRET, SUPER_EMAIL, dumpAll, seedHistory, seedStaff, setup, type World } from "./helpers/deletion-world.ts";

const asAdmin = (userId: string): Actor => ({ kind: "admin", userId });
const DUENO = asAdmin("dueno");

function expectOk<T>(r: DeletionOutcome<T>): T {
  assert.ok(r.ok, r.ok ? "" : `${r.status} ${r.error}`);
  return r.value;
}
function expectFail<T>(r: DeletionOutcome<T>, status: number): string {
  assert.equal(r.ok, false, "se esperaba un rechazo");
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.status, status, r.error);
  return r.error;
}

async function build(superOwnerEmail: string | null = SUPER_EMAIL, hashSecret: string | null = SECRET) {
  const world = setup(superOwnerEmail, hashSecret);
  await seedStaff(world);
  seedHistory(world);
  return world;
}

const one = (world: World, sql: string, ...params: (string | number | null)[]) => world.db.raw.prepare(sql).get(...params) as Record<string, unknown> | undefined;
const count = (world: World, table: string, where = "1 = 1", ...params: (string | number | null)[]) =>
  (one(world, `SELECT count(*) AS n FROM "${table}" WHERE ${where}`, ...params) as { n: number }).n;
const gerenteExists = (world: World) => count(world, "user", "id = 'gerente1'") === 1;

async function tokenFor(world: World, userId: string, opts: DeletionOptions = world.opts): Promise<string> {
  const preview = expectOk(await previewUserDeletion(world.db, DUENO, userId, opts));
  assert.ok(preview.token, "la vista previa tiene que traer el código");
  return preview.token;
}

async function ownerDelete(
  world: World, userId: string, over: Partial<{ token: string; password: string; confirmEmail: string }> = {}, opts: DeletionOptions = world.opts,
) {
  const email = (one(world, `SELECT email FROM "user" WHERE id = ?`, userId) as { email: string }).email;
  return deleteUserAsOwner(world.db, world.auth, DUENO, {
    userId, token: over.token ?? (await tokenFor(world, userId, opts)), password: over.password ?? PASSWORD, confirmEmail: over.confirmEmail ?? email,
  }, opts);
}

describe("hash del registro y secreto", () => {
  it("subject_hash es HMAC-SHA256 del email normalizado: no es el sha256 a secas, depende del secreto y no contiene el email", () => {
    const h = subjectHash(SECRET, "Gerente@Local.test ");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, subjectHash(SECRET, "gerente@local.test"));
    assert.notEqual(h, createHash("sha256").update("email:gerente@local.test").digest("hex"));
    assert.notEqual(h, createHash("sha256").update("subject:email:gerente@local.test").digest("hex"));
    assert.notEqual(h, subjectHash(`${SECRET}-otro`, "gerente@local.test"));
    assert.ok(!h.includes("gerente"));
  });

  for (const [label, secret] of [["sin secreto", null], ["vacío", ""], ["demasiado corto", "corto"]] as const) {
    it(`${label}: la herramienta y el autoservicio quedan deshabilitados (503) y no se borra nada`, async () => {
      const world = await build(SUPER_EMAIL, secret);
      const before = dumpAll(world.db.raw);
      assert.match(expectFail(await listDeletableUsers(world.db, DUENO, world.opts), 503), /DATA_DELETION_HASH_SECRET/);
      expectFail(await previewUserDeletion(world.db, DUENO, "gerente1", world.opts), 503);
      expectFail(await deleteUserAsOwner(world.db, world.auth, DUENO, { userId: "gerente1", token: "x", password: PASSWORD, confirmEmail: "gerente@local.test" }, world.opts), 503);
      assert.deepEqual(await ownAccountEligibility(world.db, "gerente1", world.opts), { canDelete: false, status: 503, reason: MESSAGES.disabled });
      expectFail(await deleteOwnAccount(world.db, world.auth, { userId: "gerente1", password: PASSWORD }, world.opts), 503);
      assert.deepEqual(dumpAll(world.db.raw), before);
    });
  }
});

describe("código de confirmación", () => {
  const T0 = 1_800_000_000_000;

  it("vale para ese dueño y ese usuario, hasta 5 minutos", () => {
    const token = issueToken(SECRET, "dueno", "gerente1", T0);
    assert.deepEqual(Object.keys(readToken(SECRET, token, "dueno", "gerente1", T0) ?? {}), ["nonce"]);
    assert.ok(readToken(SECRET, token, "dueno", "gerente1", T0 + TOKEN_TTL_MS));
    assert.equal(readToken(SECRET, token, "dueno", "gerente1", T0 + TOKEN_TTL_MS + 1), null, "vencido");
    assert.equal(readToken(SECRET, token, "socio", "gerente1", T0), null, "otro dueño");
    assert.equal(readToken(SECRET, token, "dueno", "cajero1", T0), null, "otro usuario");
    assert.equal(readToken(`${SECRET}-otro`, token, "dueno", "gerente1", T0), null, "otro secreto");
  });

  it("alterado o mal formado no vale", () => {
    const [expires, nonce, mac] = issueToken(SECRET, "dueno", "gerente1", T0).split(".");
    for (const bad of [
      "", "x", `${expires}.${nonce}`, `${expires}.${nonce}.${mac}.extra`, `${Number(expires) + 60000}.${nonce}.${mac}`, `${expires}.otro-nonce.${mac}`,
      `${expires}.${nonce}.${mac.replace(/.$/, mac.endsWith("0") ? "1" : "0")}`, `abc.${nonce}.${mac}`, `${expires}.${nonce}.${mac.slice(0, 10)}`,
    ]) assert.equal(readToken(SECRET, bad, "dueno", "gerente1", T0), null, bad);
  });

  it("cada vista previa trae uno distinto", async () => {
    const world = await build();
    assert.notEqual(await tokenFor(world, "gerente1"), await tokenFor(world, "gerente1"));
  });

  it("se usa una sola vez: la contraseña mal puesta no lo quema, pero tras borrar no se puede reutilizar", async () => {
    const world = await build();
    const token = await tokenFor(world, "cajero1");
    expectFail(await ownerDelete(world, "cajero1", { token, password: "mal" }), 400);
    expectOk(await ownerDelete(world, "cajero1", { token }));
    // Aunque el usuario volviera a existir, el mismo código ya está gastado.
    world.db.raw.prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, staff_role, banned, createdAt, updatedAt) VALUES ('cajero1', 'Cajero', 'cajero@local.test', 1, 'admin', 'cajero', 0, 'x', 'x')`).run();
    world.db.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-c2', 'cajero1', 'credential', 'cajero1', (SELECT password FROM account WHERE id = 'a-dueno'), 'x', 'x')`).run();
    assert.equal(expectFail(await ownerDelete(world, "cajero1", { token }), 409), MESSAGES.tokenUsed);
    assert.equal(count(world, "user", "id = 'cajero1'"), 1);
  });

  it("vencido (6 minutos después de la vista previa): 400 y no se borra nada", async () => {
    const world = await build();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    const token = await tokenFor(world, "gerente1", { ...world.opts, now: () => t0 });
    const later = { ...world.opts, now: () => new Date(t0.getTime() + 6 * 60_000) };
    assert.equal(expectFail(await ownerDelete(world, "gerente1", { token }, later), 400), MESSAGES.badToken);
    expectOk(await ownerDelete(world, "gerente1", { token }, { ...world.opts, now: () => new Date(t0.getTime() + 4 * 60_000) }));
  });

  it("un código de otro usuario, vacío o inventado: 400", async () => {
    const world = await build();
    const cajero = await tokenFor(world, "cajero1");
    for (const token of [cajero, "", "inventado"]) assert.equal(expectFail(await ownerDelete(world, "gerente1", { token }), 400), MESSAGES.badToken);
    assert.ok(gerenteExists(world));
  });
});

describe("herramienta del dueño principal", () => {
  it("lista solo al personal (role admin), con la protección de cada uno; el email exacto filtra", async () => {
    const world = await build();
    const users = expectOk(await listDeletableUsers(world.db, DUENO, world.opts));
    assert.deepEqual(users.map((u) => u.id).sort(), ["cajero1", "dueno", "gerente1", "socio"]);
    const by = Object.fromEntries(users.map((u) => [u.id, u]));
    assert.equal(by.dueno.blockedReason, MESSAGES.superOwner);
    assert.equal(by.socio.blockedReason, null, "queda otro dueño activo");
    assert.equal(by.gerente1.staffRole, "gerente");
    assert.deepEqual(Object.keys(by.gerente1).sort(), ["banned", "blockedReason", "createdAt", "email", "id", "name", "staffRole"]);
    for (const email of ["  GERENTE@local.test ", "gerente@local.test"]) assert.deepEqual(expectOk(await listDeletableUsers(world.db, DUENO, world.opts, email)).map((u) => u.id), ["gerente1"]);
    for (const email of ["gerente", "local.test", "cliente@example.test", "repartidor-uno@repartidores.dely.opsyn.app", ""]) {
      assert.deepEqual(expectOk(await listDeletableUsers(world.db, DUENO, world.opts, email)), [], email);
    }
  });

  const actors: Array<[string, Actor]> = [
    ["otro dueño", asAdmin("socio")], ["gerente", asAdmin("gerente1")], ["cajero", asAdmin("cajero1")], ["cliente", { kind: "cliente", userId: "u-cli" }],
    ["repartidor", { kind: "repartidor", userId: "u-rep" }], ["anónimo", { kind: "anon" }], ["sistema", { kind: "system", reason: "test" }], ["inexistente", asAdmin("nadie")],
  ];
  for (const [label, actor] of actors) {
    it(`${label}: 403 en todo y no cambia nada`, async () => {
      const world = await build();
      const before = dumpAll(world.db.raw);
      const token = issueToken(SECRET, "dueno", "gerente1", Date.now());
      const input = { userId: "gerente1", token, password: PASSWORD, confirmEmail: "gerente@local.test" };
      await assert.rejects(listDeletableUsers(world.db, actor, world.opts), { name: "ForbiddenError", message: /dueño principal/ });
      await assert.rejects(previewUserDeletion(world.db, actor, "gerente1", world.opts), { name: "ForbiddenError" });
      await assert.rejects(deleteUserAsOwner(world.db, world.auth, actor, input, world.opts), { name: "ForbiddenError" });
      await assert.rejects(listDeletionRequests(world.db, actor, world.opts), { name: "ForbiddenError" });
      assert.deepEqual(dumpAll(world.db.raw), before);
    });
  }

  it("sin SUPER_OWNER_EMAIL, o con el dueño principal bloqueado, nadie puede", async () => {
    await assert.rejects(listDeletableUsers((await build(null)).db, DUENO, { superOwnerEmail: null, hashSecret: SECRET }), { name: "ForbiddenError" });
    const world = await build();
    world.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
    await assert.rejects(listDeletableUsers(world.db, DUENO, world.opts), { name: "ForbiddenError" });
  });

  it("la vista previa muestra quién es, qué se borra (con conteos) y qué se conserva, sin datos de la cuenta", async () => {
    const world = await build();
    const preview = expectOk(await previewUserDeletion(world.db, DUENO, "gerente1", world.opts));
    assert.deepEqual({ id: preview.user.id, name: preview.user.name, email: preview.user.email, staffRole: preview.user.staffRole }, { id: "gerente1", name: "Gerente Uno", email: "gerente@local.test", staffRole: "gerente" });
    assert.deepEqual(Object.fromEntries(preview.deletes.map((d) => [d.key, d.count])), { session: 1, account: 1, verification: 2, intentos: 0, user: 1 });
    assert.deepEqual(preview.keeps, KEPT);
    assert.ok(preview.token);
    const json = JSON.stringify(preview);
    for (const secret of ["tok-gerente1", "203.0.113.5", "token-g1", String((one(world, `SELECT password FROM account WHERE id = 'a-gerente1'`) as { password: string }).password)]) assert.ok(!json.includes(secret), secret);
    assert.equal(count(world, "data_deletion_requests"), 0, "previsualizar no registra ni cambia nada");
  });

  it("solo usuarios del personal: clientes, repartidores e inexistentes dan 404", async () => {
    const world = await build();
    for (const id of ["u-cli", "u-rep", "nadie", ""]) assert.equal(expectFail(await previewUserDeletion(world.db, DUENO, id, world.opts), 404), MESSAGES.notFound, id);
  });

  it("el dueño principal se ve pero no se puede eliminar: sin código", async () => {
    const world = await build();
    const preview = expectOk(await previewUserDeletion(world.db, DUENO, "dueno", world.opts));
    assert.equal(preview.user.blockedReason, MESSAGES.superOwner);
    assert.equal(preview.token, null);
    // Aunque alguien armara un código para él: 403.
    const forged = issueToken(SECRET, "dueno", "dueno", Date.now());
    assert.equal(expectFail(await deleteUserAsOwner(world.db, world.auth, DUENO, { userId: "dueno", token: forged, password: PASSWORD, confirmEmail: SUPER_EMAIL }, world.opts), 403), MESSAGES.superOwner);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
  });

  it("elimina cuenta, sesiones, credenciales y tokens (por email y por id); los de los demás quedan", async () => {
    const world = await build();
    world.db.raw.prepare(`INSERT INTO courier_pin_attempts (key, failures, window_start) VALUES ('delete-account:gerente1', 2, '2026-11-10T00:00:00.000Z')`).run();
    const notified: string[] = [];
    const result = expectOk(await ownerDelete(world, "gerente1", {}, { ...world.opts, notify: async (to) => void notified.push(to) }));
    assert.deepEqual(result.counts, { session: 1, account: 1, verification: 2, intentos: 1, user: 1 });
    assert.equal(result.total, 6);
    assert.equal(result.notified, "sent");
    assert.deepEqual(notified, ["gerente@local.test"]);
    assert.equal(count(world, "user", "id = 'gerente1'") + count(world, "session", "userId = 'gerente1'") + count(world, "account", "userId = 'gerente1'"), 0);
    assert.equal(count(world, "verification", "id IN ('v-g1', 'v-g2')"), 0);
    assert.equal(count(world, "courier_pin_attempts", "key = 'delete-account:gerente1'"), 0);
    assert.equal(count(world, "verification", "id = 'v-s1'"), 1);
    assert.equal(count(world, "user", "id IN ('dueno', 'socio', 'cajero1')"), 3);
    assert.equal(count(world, "session", "userId IN ('dueno', 'socio', 'cajero1')"), 3);
  });

  it("registra sin datos en claro: hash HMAC del email, canal 'admin', quién lo hizo y los conteos", async () => {
    const world = await build();
    const result = expectOk(await ownerDelete(world, "gerente1"));
    const rows = world.db.raw.prepare(`SELECT * FROM data_deletion_requests`).all() as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, result.requestId);
    assert.equal(rows[0].subject_hash, subjectHash(SECRET, "gerente@local.test"));
    assert.deepEqual({ channel: rows[0].channel, performed_by: rows[0].performed_by, status: rows[0].status, error: rows[0].error }, { channel: "admin", performed_by: "dueno", status: "completed", error: null });
    assert.deepEqual(JSON.parse(String(rows[0].counts)), result.counts);
    const flat = JSON.stringify(rows).toLowerCase();
    for (const dato of ["gerente@local.test", "gerente uno", "gerente1", "local.test"]) assert.ok(!flat.includes(dato), dato);
    const [view] = await listDeletionRequests(world.db, DUENO, world.opts);
    assert.deepEqual(Object.keys(view).sort(), ["channel", "completedAt", "counts", "error", "id", "requestedAt", "status", "total"]);
  });

  it("si el aviso por email falla, el borrado vale igual y queda dicho; sin proveedor se omite", async (t) => {
    t.mock.method(console, "error", () => undefined);
    const world = await build();
    const failing = expectOk(await ownerDelete(world, "gerente1", {}, { ...world.opts, notify: async () => { throw new Error("sin correo"); } }));
    assert.equal(failing.notified, "failed");
    assert.equal(failing.status, "completed");
    assert.equal(gerenteExists(world), false);
    assert.equal(expectOk(await ownerDelete(world, "cajero1")).notified, "skipped");
  });

  it("exige el email exacto del usuario (sin importar mayúsculas ni espacios) y la contraseña del dueño", async () => {
    const world = await build();
    const token = await tokenFor(world, "gerente1");
    for (const confirmEmail of ["", "gerente", "cajero@local.test", "gerente@local.test.ar", "ELIMINAR"]) {
      assert.equal(expectFail(await ownerDelete(world, "gerente1", { token, confirmEmail }), 400), MESSAGES.emailMismatch, confirmEmail);
    }
    assert.equal(expectFail(await ownerDelete(world, "gerente1", { token, password: "no-es-la-clave" }), 400), MESSAGES.wrongPassword);
    assert.equal(expectFail(await ownerDelete(world, "gerente1", { token, password: "" }), 400), MESSAGES.wrongPassword);
    assert.ok(gerenteExists(world));
    expectOk(await ownerDelete(world, "gerente1", { token, confirmEmail: "  GERENTE@Local.TEST " }));
  });

  it("tras 5 contraseñas incorrectas del dueño se bloquea (429), incluso con la correcta, hasta que pasa el bloqueo", async () => {
    const world = await build();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    const at = (d: Date): DeletionOptions => ({ ...world.opts, now: () => d });
    const token = await tokenFor(world, "gerente1", at(t0));
    for (let i = 0; i < 5; i++) expectFail(await ownerDelete(world, "gerente1", { token, password: "mal" }, at(t0)), 400);
    expectFail(await ownerDelete(world, "gerente1", { token }, at(t0)), 429);
    assert.ok(gerenteExists(world));
    assert.equal(count(world, "courier_pin_attempts", "key = '__global__'"), 0, "no toca el tope global del PIN");
    const later = new Date(t0.getTime() + 31 * 60_000);
    const fresh = await tokenFor(world, "gerente1", at(later));
    expectOk(await ownerDelete(world, "gerente1", { token: fresh }, at(later)));
    assert.equal(count(world, "courier_pin_attempts", "key LIKE 'delete-user:%'"), 0, "se limpia al terminar");
  });

  it("otro dueño se elimina mientras quede un dueño activo; si el dueño principal deja de estar activo justo antes del lote, la guarda revierte TODO", async (t) => {
    t.mock.method(console, "error", () => undefined);
    const world = await build();
    const token = await tokenFor(world, "socio");
    const racing = { ...world.db, batch: async (s: Parameters<typeof world.db.batch>[0]) => {
      world.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
      return world.db.batch(s);
    } };
    const before = dumpAll(world.db.raw, ["data_deletion_requests.status", "data_deletion_requests.completed_at", "data_deletion_requests.error", "user.banned", "user.updatedAt"]);
    const error = expectFail(await deleteUserAsOwner(racing as World["db"], world.auth, DUENO, { userId: "socio", token, password: PASSWORD, confirmEmail: "socio@local.test" }, world.opts), 409);
    assert.equal(error, MESSAGES.lastOwner);
    const after = dumpAll(world.db.raw, ["data_deletion_requests.status", "data_deletion_requests.completed_at", "data_deletion_requests.error", "user.banned", "user.updatedAt"]);
    assert.deepEqual({ ...after, data_deletion_requests: "", bot_nonces: "", courier_pin_attempts: "" }, { ...before, data_deletion_requests: "", bot_nonces: "", courier_pin_attempts: "" });
    assert.equal(count(world, "user", "id = 'socio'"), 1);
    assert.equal(one(world, `SELECT status FROM data_deletion_requests`)?.status, "failed");

    const clean = await build();
    expectOk(await ownerDelete(clean, "socio"));
    assert.equal(count(clean, "user", "id = 'socio'"), 0);
  });
});

describe("el historial no se toca", () => {
  const ALLOWED = ["user", "session", "account", "verification", "courier_pin_attempts", "data_deletion_requests", "bot_nonces"];
  // La ficha del cliente y la constancia solo pierden el vínculo con el usuario.
  const OMIT = ["clients.user_id", "clients.updated_at", "legal_acceptances.user_id"];

  it("eliminar al gerente (que también compró como cliente) no cambia ni una fila de ninguna otra tabla", async () => {
    const world = await build();
    const before = dumpAll(world.db.raw, OMIT);
    expectOk(await ownerDelete(world, "gerente1"));
    const after = dumpAll(world.db.raw, OMIT);
    for (const table of Object.keys(before).filter((t) => !ALLOWED.includes(t))) assert.equal(after[table], before[table], `cambió ${table}`);
    assert.equal(Object.keys(before).length, Object.keys(after).length);
  });

  it("los pedidos, clientes, puntos, reseñas, pagos, conversaciones, reclamos y constancias siguen; la ficha y la constancia quedan sin usuario", async () => {
    const world = await build();
    expectOk(await ownerDelete(world, "gerente1"));
    for (const [table, where] of [
      ["orders", "id IN ('o-1', 'o-2')"], ["order_items", "id = 'i-1'"], ["order_events", "id = 'e-1'"], ["fudo_writes", "id = 'fw-1' AND actor = 'admin:gerente1'"],
      ["clients", "id IN ('c-cli', 'c-ger')"], ["points_ledger", "id = 'l-1'"], ["reviews", "id = 'r-1'"], ["payment_intents", "id = 'pi-1'"],
      ["wa_conversations", "id = 'w-1'"], ["wa_messages", "id = 'wm-1'"], ["reclamos", "id = 'rc-1'"], ["reclamos_eventos", "id = 're-1'"],
      ["integration_settings", "updated_by = 'gerente1'"], ["legal_acceptances", "id IN ('la-1', 'la-2')"], ["kb_errores", "id = 'kbe-1'"], ["global_config", "key = 'resumen_diario'"],
    ] as const) assert.ok(count(world, table, where) >= 1, `${table} perdió filas`);
    assert.equal(count(world, "clients", "id = 'c-ger' AND user_id IS NULL"), 1);
    assert.equal(count(world, "clients", "id = 'c-cli' AND user_id = 'u-cli'"), 1);
    assert.equal(count(world, "points_ledger"), 1);
    assert.equal(count(world, "couriers") + count(world, "courier_locations") + count(world, "courier_shifts"), 3, "los repartidores no se tocan");
    assert.deepEqual(one(world, `SELECT user_id, email, ip, user_agent FROM legal_acceptances WHERE id = 'la-1'`) && { ...one(world, `SELECT user_id, email, ip, user_agent FROM legal_acceptances WHERE id = 'la-1'`) },
      { user_id: null, email: "gerente@local.test", ip: "203.0.113.9", user_agent: "UA-x" });
    assert.equal(count(world, "legal_acceptances", "id = 'la-2' AND user_id = 'u-cli'"), 1);
  });

  it("por la base, borrar un usuario con ficha de cliente no arrastra puntos, reseñas ni pagos (trigger de la migración 0020)", () => {
    const world = setup();
    return seedStaff(world).then(() => {
      seedHistory(world);
      world.db.raw.prepare(`DELETE FROM "user" WHERE id = 'gerente1'`).run();
      assert.equal(count(world, "clients", "id = 'c-ger' AND user_id IS NULL"), 1);
      for (const t of ["points_ledger", "reviews", "payment_intents"]) assert.equal(count(world, t), 1, t);
      assert.equal(count(world, "orders", "id = 'o-2'"), 1);
    });
  });

  it("las claves foráneas a user están revisadas: una nueva con CASCADE rompe esta prueba hasta que se decida qué hacer con ella", () => {
    const world = setup();
    const tables = (world.db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name);
    const found: string[] = [];
    for (const t of tables) {
      for (const fk of world.db.raw.prepare(`SELECT "table" AS ref, "from" AS col, on_delete AS onDelete FROM pragma_foreign_key_list('${t}')`).all() as { ref: string; col: string; onDelete: string }[]) {
        if (fk.ref === "user") found.push(`${t}.${fk.col} ${fk.onDelete}`);
      }
    }
    assert.deepEqual(found.sort(), [
      "account.userId CASCADE", "clients.user_id CASCADE", "courier_locations.user_id CASCADE", "courier_shifts.user_id CASCADE", "couriers.user_id CASCADE",
      "legal_acceptances.user_id SET NULL", "orders.courier_user_id SET NULL", "session.userId CASCADE",
    ]);
    // clients es el único CASCADE que arrastra historial y lo cubre el trigger; los repartidores no se borran (role = 'admin').
    assert.ok(DELETION_STEPS.find((s) => s.key === "user")?.del.includes("role = 'admin'"));
  });
});

describe("autoservicio del personal", () => {
  const own = (world: World, userId: string, password = PASSWORD, now?: Date, notify?: DeletionOptions["notify"]) =>
    deleteOwnAccount(world.db, world.auth, { userId, password }, { ...world.opts, now: now ? () => now : undefined, notify });

  it("con la contraseña correcta borra la cuenta de inmediato, registra 'autoservicio', avisa y no toca el historial", async () => {
    const world = await build();
    const before = dumpAll(world.db.raw, ["clients.user_id", "clients.updated_at", "legal_acceptances.user_id"]);
    const notified: string[] = [];
    const result = expectOk(await own(world, "gerente1", PASSWORD, undefined, async (to) => void notified.push(to)));
    assert.equal(result.status, "completed");
    assert.deepEqual(notified, ["gerente@local.test"]);
    assert.equal(gerenteExists(world), false);
    const row = one(world, `SELECT channel, performed_by, status, subject_hash FROM data_deletion_requests`);
    assert.deepEqual({ ...row }, { channel: "autoservicio", performed_by: "gerente1", status: "completed", subject_hash: subjectHash(SECRET, "gerente@local.test") });
    const after = dumpAll(world.db.raw, ["clients.user_id", "clients.updated_at", "legal_acceptances.user_id"]);
    for (const t of Object.keys(before).filter((k) => !["user", "session", "account", "verification", "courier_pin_attempts", "data_deletion_requests", "bot_nonces"].includes(k))) assert.equal(after[t], before[t], t);
    const login = await world.auth.handler(new Request(`${BASE}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "10.9.1.1" }, body: JSON.stringify({ email: "gerente@local.test", password: PASSWORD }),
    }));
    assert.notEqual(login.status, 200);
  });

  it("contraseña incorrecta: 400 y no borra; tras 5, 429 hasta que pasa el bloqueo", async () => {
    const world = await build();
    const t0 = new Date("2026-11-10T12:00:00.000Z");
    assert.equal(expectFail(await own(world, "cajero1", "mal", t0), 400), MESSAGES.wrongPassword);
    for (let i = 0; i < 4; i++) expectFail(await own(world, "cajero1", "mal", t0), 400);
    expectFail(await own(world, "cajero1", PASSWORD, t0), 429);
    assert.equal(count(world, "user", "id = 'cajero1'"), 1);
    expectOk(await own(world, "cajero1", PASSWORD, new Date(t0.getTime() + 31 * 60_000)));
    assert.equal(count(world, "courier_pin_attempts", "key LIKE 'delete-account:%'"), 0);
  });

  it("los clientes NO pueden (403, con a quién pedir la baja), ni con contraseña correcta; los repartidores tampoco", async () => {
    const world = await build();
    world.db.raw.prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-cli', 'u-cli', 'credential', 'u-cli', (SELECT password FROM account WHERE id = 'a-dueno'), 'x', 'x')`).run();
    const before = dumpAll(world.db.raw);
    assert.equal(expectFail(await own(world, "u-cli"), 403), SELF_MESSAGES.notStaff);
    assert.match(SELF_MESSAGES.notStaff, /contacto@la-gambeta\.com/);
    expectFail(await own(world, "u-rep"), 403);
    assert.deepEqual(dumpAll(world.db.raw), before);
    assert.deepEqual(await ownAccountEligibility(world.db, "u-cli", world.opts), { canDelete: false, status: 403, reason: SELF_MESSAGES.notStaff });
  });

  it("el dueño principal NO puede (403), ni con la contraseña correcta", async () => {
    const world = await build();
    assert.equal(expectFail(await own(world, "dueno"), 403), SELF_MESSAGES.superOwner);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
  });

  it("otro dueño puede mientras haya otro dueño activo; el último activo no (409), y uno bloqueado no cuenta", async () => {
    const world = await build(null);
    expectOk(await own(world, "socio"));
    assert.equal(expectFail(await own(world, "dueno"), 409), SELF_MESSAGES.lastOwner);
    assert.equal(count(world, "user", "id = 'dueno'"), 1);
    const blocked = await build(null);
    blocked.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
    assert.equal(expectFail(await own(blocked, "socio"), 409), SELF_MESSAGES.lastOwner);
  });

  it("una cuenta sin contraseña o inexistente no puede", async () => {
    const world = await build();
    world.db.raw.prepare(`DELETE FROM "account" WHERE userId = 'cajero1'`).run();
    assert.equal(expectFail(await own(world, "cajero1"), 400), MESSAGES.noPassword);
    expectFail(await own(world, "nadie"), 404);
  });
});
