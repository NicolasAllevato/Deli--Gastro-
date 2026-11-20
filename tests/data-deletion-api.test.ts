/**
 * Lógica de /api/admin/eliminar-datos y /api/account/delete (src/lib/deletion/api.ts): validación con zod, códigos HTTP y contrato de la
 * respuesta, contra la capa de datos real sobre node:sqlite. La ruta de Next solo suma sesión, CSRF y límite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import type { Actor } from "../src/lib/data/actor.ts";
import {
  deleteOwnAccount, deleteUserAsOwner, listDeletableUsers, listDeletionRequests, ownAccountEligibility, previewUserDeletion, type DeletionOptions,
} from "../src/lib/data/data-deletion.ts";
import { PASSWORD, SECRET, SUPER_EMAIL, seedHistory, seedStaff, setup, type World } from "./helpers/deletion-world.ts";

const { authCookiesToExpire, deleteOwnApi, eligibilityApi, executeApi, executeBodySchema, listApi, previewApi } = await import("../src/lib/deletion/api.ts");
const { accountDeletedNotifier, buildDeletedEmail } = await import("../src/lib/deletion/notify.ts");
import type { DeletionPort } from "../src/lib/deletion/api.ts";

const asAdmin = (userId: string): Actor => ({ kind: "admin", userId });
const SUPER = { isSuperOwner: true };
const NOT_SUPER = { isSuperOwner: false };

async function build(superOwnerEmail: string | null = SUPER_EMAIL, hashSecret: string | null = SECRET) {
  const world: World = setup(superOwnerEmail, hashSecret);
  await seedStaff(world);
  seedHistory(world);
  const port = (opts: DeletionOptions = world.opts): DeletionPort<Actor> => ({
    users: (actor, email) => listDeletableUsers(world.db, actor, opts, email),
    recent: (actor) => listDeletionRequests(world.db, actor, opts),
    preview: (actor, userId) => previewUserDeletion(world.db, actor, userId, opts),
    execute: (actor, input, notify) => deleteUserAsOwner(world.db, world.auth, actor, input, { ...opts, notify }),
    eligibility: (userId) => ownAccountEligibility(world.db, userId, opts),
    deleteOwn: (userId, password, notify) => deleteOwnAccount(world.db, world.auth, { userId, password }, { ...opts, notify }),
  });
  return { world, port: port() };
}

const userCount = (world: World, id: string) => (world.db.raw.prepare(`SELECT count(*) AS n FROM "user" WHERE id = ?`).get(id) as { n: number }).n;
const body = (r: { body: unknown }) => r.body as Record<string, unknown>;

async function previewToken(port: DeletionPort<Actor>, userId: string): Promise<string> {
  const r = await previewApi(port, SUPER, asAdmin("dueno"), { userId });
  assert.equal(r.status, 200);
  const token = (body(r).preview as { token: string | null }).token;
  assert.ok(token);
  return token;
}

describe("GET /api/admin/eliminar-datos", () => {
  it("el dueño principal recibe el personal y los eliminados recientes, sin clientes ni repartidores", async () => {
    const { port } = await build();
    const r = await listApi(port, SUPER, asAdmin("dueno"), {});
    assert.equal(r.status, 200);
    assert.deepEqual((body(r).users as { id: string }[]).map((u) => u.id).sort(), ["cajero1", "dueno", "gerente1", "socio"]);
    assert.deepEqual(body(r).recent, []);
  });

  it("con ?email= devuelve solo el usuario de ese email exacto", async () => {
    const { port } = await build();
    assert.deepEqual(((await listApi(port, SUPER, asAdmin("dueno"), { email: "gerente@local.test" })).body as { users: { id: string }[] }).users.map((u) => u.id), ["gerente1"]);
    assert.deepEqual(((await listApi(port, SUPER, asAdmin("dueno"), { email: "gerente@local" })).status), 400, "no es un email");
    assert.deepEqual(((await listApi(port, SUPER, asAdmin("dueno"), { email: "nadie@local.test" })).body as { users: unknown[] }).users, []);
  });

  it("otro dueño, gerente o cajero: 403 (la ruta los corta; la capa de datos también)", async () => {
    const { port, world } = await build();
    for (const id of ["socio", "gerente1", "cajero1"]) {
      assert.equal((await listApi(port, NOT_SUPER, asAdmin(id), {})).status, 403, id);
      const leaked = await listApi(port, SUPER, asAdmin(id), {});
      assert.equal(leaked.status, 403, `${id} (capa de datos)`);
      assert.match(String(body(leaked).error), /dueño principal/);
    }
    assert.equal(userCount(world, "gerente1"), 1);
  });

  it("sin DATA_DELETION_HASH_SECRET: 503 con un mensaje claro", async () => {
    const { port } = await build(SUPER_EMAIL, null);
    const r = await listApi(port, SUPER, asAdmin("dueno"), {});
    assert.equal(r.status, 503);
    assert.match(String(body(r).error), /DATA_DELETION_HASH_SECRET/);
  });
});

describe("POST /api/admin/eliminar-datos/vista-previa", () => {
  it("devuelve quién es, qué se borra, qué se conserva y el código de un solo uso", async () => {
    const { port } = await build();
    const r = await previewApi(port, SUPER, asAdmin("dueno"), { userId: "gerente1" });
    assert.equal(r.status, 200);
    const preview = body(r).preview as { user: { email: string; staffRole: string }; deletes: { key: string }[]; keeps: string[]; token: string };
    assert.deepEqual([preview.user.email, preview.user.staffRole], ["gerente@local.test", "gerente"]);
    assert.deepEqual(preview.deletes.map((d) => d.key), ["session", "account", "verification", "intentos", "user"]);
    assert.ok(preview.keeps.length > 0);
    assert.match(preview.token, /^\d+\.[0-9a-f-]+\.[0-9a-f]{64}$/);
  });

  it("validación: cuerpo estricto y sin usuario, 400; cliente, repartidor o inexistente, 404; no cambia nada", async () => {
    const { port, world } = await build();
    for (const raw of [null, {}, { userId: "" }, { userId: "a b" }, { userId: "gerente1", extra: 1 }, { userId: 5 }, "texto"]) {
      assert.equal((await previewApi(port, SUPER, asAdmin("dueno"), raw)).status, 400, JSON.stringify(raw));
    }
    for (const userId of ["u-cli", "u-rep", "nadie"]) assert.equal((await previewApi(port, SUPER, asAdmin("dueno"), { userId })).status, 404, userId);
    assert.equal((world.db.raw.prepare(`SELECT count(*) AS n FROM data_deletion_requests`).get() as { n: number }).n, 0);
  });

  it("el dueño principal se ve, pero sin código; otro dueño, gerente o cajero: 403", async () => {
    const { port } = await build();
    const r = await previewApi(port, SUPER, asAdmin("dueno"), { userId: "dueno" });
    assert.equal((body(r).preview as { token: unknown }).token, null);
    for (const id of ["socio", "gerente1", "cajero1"]) {
      assert.equal((await previewApi(port, NOT_SUPER, asAdmin(id), { userId: "cajero1" })).status, 403, id);
      assert.equal((await previewApi(port, SUPER, asAdmin(id), { userId: "cajero1" })).status, 403, `${id} (capa de datos)`);
    }
  });
});

describe("POST /api/admin/eliminar-datos", () => {
  const input = (token: string, over: Record<string, unknown> = {}) => ({ userId: "gerente1", token, password: PASSWORD, confirmEmail: "gerente@local.test", ...over });

  it("con el código, la contraseña del dueño y el email exacto elimina y avisa por email", async () => {
    const { port, world } = await build();
    const sent: string[] = [];
    const r = await executeApi(port, SUPER, asAdmin("dueno"), input(await previewToken(port, "gerente1")), async (to) => void sent.push(to));
    assert.equal(r.status, 200);
    const result = body(r).result as { status: string; total: number; notified: string };
    assert.deepEqual([result.status, result.total, result.notified], ["completed", 5, "sent"]);
    assert.deepEqual(sent, ["gerente@local.test"]);
    assert.equal(userCount(world, "gerente1"), 0);
    assert.equal(((await listApi(port, SUPER, asAdmin("dueno"), {})).body as { recent: unknown[] }).recent.length, 1);
  });

  it("cuerpo estricto: sin código, sin contraseña, sin email, campos de más o la palabra ELIMINAR en vez del email, 400 y no borra", async () => {
    const { port, world } = await build();
    const token = await previewToken(port, "gerente1");
    const bad: unknown[] = [null, {}, input(""), input(token, { password: "" }), input(token, { confirmEmail: "" }), input(token, { confirm: "ELIMINAR" }), input(token, { token: 5 }), input(token, { password: "x".repeat(129) })];
    for (const raw of bad) assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), raw)).status, 400, JSON.stringify(raw));
    assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), input(token, { confirmEmail: "ELIMINAR" }))).status, 400);
    assert.equal(userCount(world, "gerente1"), 1);
    assert.equal(executeBodySchema.safeParse(input(token)).success, true);
  });

  it("un código inventado, de otro usuario o usado: 400 / 409; contraseña incorrecta: 400", async () => {
    const { port, world } = await build();
    const cajero = await previewToken(port, "cajero1");
    assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), input(cajero))).status, 400, "código de otro usuario");
    assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), input("inventado"))).status, 400);
    const token = await previewToken(port, "gerente1");
    assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), input(token, { password: "mal" }))).status, 400);
    assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), input(token))).status, 200);
    assert.equal(userCount(world, "gerente1"), 0);
  });

  it("otro dueño, gerente o cajero: 403 y no se borra nada", async () => {
    const { port, world } = await build();
    const token = await previewToken(port, "gerente1");
    for (const id of ["socio", "gerente1", "cajero1"]) {
      assert.equal((await executeApi(port, NOT_SUPER, asAdmin(id), input(token))).status, 403, id);
      assert.equal((await executeApi(port, SUPER, asAdmin(id), input(token))).status, 403, `${id} (capa de datos)`);
    }
    assert.equal(userCount(world, "gerente1"), 1);
  });

  it("el dueño principal no se puede eliminar aun con un código armado a mano: 403", async () => {
    const { port, world } = await build();
    const { issueToken } = await import("../src/lib/data/data-deletion.ts");
    const forged = issueToken(SECRET, "dueno", "dueno", Date.now());
    const r = await executeApi(port, SUPER, asAdmin("dueno"), { userId: "dueno", token: forged, password: PASSWORD, confirmEmail: SUPER_EMAIL });
    assert.equal(r.status, 403);
    assert.equal(userCount(world, "dueno"), 1);
  });
});

describe("GET y POST /api/account/delete", () => {
  it("elegibilidad: el personal puede; el dueño principal no, con el motivo", async () => {
    const { port } = await build();
    assert.deepEqual((await eligibilityApi(port, { userId: "gerente1", role: "admin" })).body, { canDelete: true, reason: null });
    const principal = body(await eligibilityApi(port, { userId: "dueno", role: "admin" }));
    assert.equal(principal.canDelete, false);
    assert.match(String(principal.reason), /dueño principal/);
  });

  it("clientes y repartidores: 403 en ambos métodos, aunque la contraseña sea correcta, y no se toca nada", async () => {
    const { port, world } = await build();
    for (const [userId, role] of [["u-cli", "cliente"], ["u-rep", "repartidor"], ["gerente1", "cliente"], ["gerente1", "desconocido"]] as const) {
      const e = await eligibilityApi(port, { userId, role });
      assert.equal(e.status, 403, `${userId}/${role} GET`);
      assert.match(String(body(e).error), /contacto@la-gambeta\.com/);
      assert.equal((await deleteOwnApi(port, { userId, role }, { password: PASSWORD, confirm: "ELIMINAR" })).status, 403, `${userId}/${role} POST`);
    }
    for (const id of ["u-cli", "u-rep", "gerente1"]) assert.equal(userCount(world, id), 1);
  });

  it("el cuerpo exige contraseña y la palabra ELIMINAR; el usuario sale de la sesión, no del cuerpo", async () => {
    const { port, world } = await build();
    const bad: unknown[] = [{}, { password: "", confirm: "ELIMINAR" }, { password: PASSWORD }, { password: PASSWORD, confirm: "eliminar" }, { password: PASSWORD, confirm: "ELIMINAR", userId: "cajero1" }, { password: "x".repeat(129), confirm: "ELIMINAR" }, null];
    for (const raw of bad) assert.equal((await deleteOwnApi(port, { userId: "gerente1", role: "admin" }, raw)).status, 400, JSON.stringify(raw));
    assert.equal(userCount(world, "gerente1"), 1);
    assert.equal(userCount(world, "cajero1"), 1);
  });

  it("contraseña incorrecta: 400 y no borra; correcta: 200 { ok: true }, borra solo a quien está en la sesión y avisa", async () => {
    const { port, world } = await build();
    const wrong = await deleteOwnApi(port, { userId: "gerente1", role: "admin" }, { password: "no-es-la-clave", confirm: "ELIMINAR" });
    assert.equal(wrong.status, 400);
    assert.equal(body(wrong).error, "La contraseña no es correcta.");
    assert.equal(userCount(world, "gerente1"), 1);
    const sent: string[] = [];
    const ok = await deleteOwnApi(port, { userId: "gerente1", role: "admin" }, { password: PASSWORD, confirm: "ELIMINAR" }, async (to) => void sent.push(to));
    assert.deepEqual(ok, { status: 200, body: { ok: true } });
    assert.deepEqual(sent, ["gerente@local.test"]);
    assert.equal(userCount(world, "gerente1"), 0);
    assert.equal(userCount(world, "cajero1"), 1);
    assert.equal((world.db.raw.prepare(`SELECT channel FROM data_deletion_requests`).get() as { channel: string }).channel, "autoservicio");
  });

  it("el dueño principal: 403 aun con la contraseña correcta; sin secreto: 503", async () => {
    const { port, world } = await build();
    assert.equal((await deleteOwnApi(port, { userId: "dueno", role: "admin" }, { password: PASSWORD, confirm: "ELIMINAR" })).status, 403);
    assert.equal(userCount(world, "dueno"), 1);
    const off = await build(SUPER_EMAIL, null);
    assert.equal((await deleteOwnApi(off.port, { userId: "gerente1", role: "admin" }, { password: PASSWORD, confirm: "ELIMINAR" })).status, 503);
    assert.equal(userCount(off.world, "gerente1"), 1);
  });
});

describe("cookies de sesión y aviso por email", () => {
  it("al eliminar la cuenta se vencen solo las de Better Auth (prefijo opsyn, con o sin __Secure-)", () => {
    assert.deepEqual(
      authCookiesToExpire(["__Secure-opsyn.session_token", "opsyn.session_data", "__Secure-opsyn.dont_remember", "theme", "__Host-x", "otro-opsyn.x", "opsyn-sin-punto"]),
      ["__Secure-opsyn.session_token", "opsyn.session_data", "__Secure-opsyn.dont_remember"],
    );
    assert.deepEqual(authCookiesToExpire([]), []);
  });

  it("el email de aviso dice que la cuenta fue eliminada y a quién escribir; sin proveedor de correo no hay notificador", async () => {
    const mail = buildDeletedEmail();
    assert.match(mail.subject, /fue eliminada/);
    for (const part of [mail.text, mail.html]) assert.match(part, /contacto@la-gambeta\.com/);
    assert.ok(!/<script/i.test(mail.html));
    const saved = { RESEND_API_KEY: process.env.RESEND_API_KEY };
    delete process.env.RESEND_API_KEY;
    try {
      assert.equal(await accountDeletedNotifier(), undefined);
    } finally {
      if (saved.RESEND_API_KEY !== undefined) process.env.RESEND_API_KEY = saved.RESEND_API_KEY;
    }
  });
});
