/**
 * Lógica de /api/admin/eliminar-datos y /api/account/delete (src/lib/deletion/api.ts): validación con zod, códigos HTTP y contrato de
 * la respuesta, contra la capa de datos real sobre node:sqlite. La ruta de Next solo suma sesión, CSRF y límite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import type { Actor } from "../src/lib/data/actor.ts";
import { deleteOwnAccount, deleteSubjectData, listDeletionRequests, ownAccountEligibility, previewDeletion } from "../src/lib/data/data-deletion.ts";
import { MARKERS, MARTA, PASSWORD, SUPER_EMAIL, hashPassword, seedWorld, setup, type World } from "./helpers/deletion-world.ts";

const { authCookiesToExpire, deleteOwnApi, eligibilityApi, executeApi, executeBodySchema, previewApi } = await import("../src/lib/deletion/api.ts");
import type { DeletionPort } from "../src/lib/deletion/api.ts";

const asAdmin = (userId: string): Actor => ({ kind: "admin", userId });
const SUPER = { isSuperOwner: true };
const NOT_SUPER = { isSuperOwner: false };
const PHONE = "+54 9 11 5555-0101";

async function build(superOwnerEmail: string | null = SUPER_EMAIL) {
  const world: World = setup(superOwnerEmail);
  await seedWorld(world);
  const opts = { ...world.opts, files: world.files };
  const port: DeletionPort<Actor> = {
    preview: (actor, subject) => previewDeletion(world.db, actor, subject, opts),
    execute: (actor, input, files) => deleteSubjectData(world.db, actor, input, { ...opts, files: files ?? null }),
    recent: (actor) => listDeletionRequests(world.db, actor, opts),
    eligibility: (userId) => ownAccountEligibility(world.db, userId, opts),
    deleteOwn: (userId, password, files) => deleteOwnAccount(world.db, world.auth, { userId, password }, { ...opts, files: files ?? null }),
  };
  return { world, port };
}

const usersLeft = (world: World, id: string) => (world.db.raw.prepare(`SELECT count(*) AS n FROM "user" WHERE id = ?`).get(id) as { n: number }).n;
const body = (r: { body: unknown }) => r.body as Record<string, unknown>;

describe("GET /api/admin/eliminar-datos", () => {
  it("el dueño principal sin parámetros recibe los pedidos recientes y ninguna previsualización", async () => {
    const { port } = await build();
    const r = await previewApi(port, SUPER, asAdmin("dueno"), {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { preview: null, recent: [] });
  });

  it("con ?phone= devuelve la previsualización (solo conteos) y los recientes", async () => {
    const { port } = await build();
    const r = await previewApi(port, SUPER, asAdmin("dueno"), { phone: PHONE });
    assert.equal(r.status, 200);
    const preview = body(r).preview as { found: boolean; total: number };
    assert.equal(preview.found, true);
    assert.equal(preview.total, 24);
    const json = JSON.stringify(r.body).toLowerCase();
    for (const marker of MARKERS) assert.ok(!json.includes(marker.toLowerCase()), marker);
  });

  it("con ?email= llega a lo mismo", async () => {
    const { port } = await build();
    const r = await previewApi(port, SUPER, asAdmin("dueno"), { email: MARTA.email });
    assert.equal((body(r).preview as { total: number }).total, 24);
  });

  it("otro dueño, gerente o cajero: 403 sin tocar la base (la ruta los corta; la capa de datos también)", async () => {
    const { port, world } = await build();
    for (const id of ["socio", "gerente1", "cajero1"]) {
      const r = await previewApi(port, NOT_SUPER, asAdmin(id), { phone: PHONE });
      assert.equal(r.status, 403, id);
      assert.match(String(body(r).error), /dueño principal/);
      // Aunque la ruta dejara pasar (isSuperOwner mal resuelto), la capa de datos lo verifica contra la base.
      const leaked = await previewApi(port, SUPER, asAdmin(id), { phone: PHONE });
      assert.equal(leaked.status, 403, `${id} (capa de datos)`);
    }
    assert.equal(usersLeft(world, MARTA.userId), 1);
  });

  it("ambos parámetros, o ninguno válido: 400", async () => {
    const { port } = await build();
    for (const query of [{ phone: PHONE, email: MARTA.email }, { phone: "123" }, { phone: "abc12345678" }, { phone: "" }, { email: "no-es-un-email" }]) {
      const r = await previewApi(port, SUPER, asAdmin("dueno"), query);
      assert.equal(r.status, 400, JSON.stringify(query));
      assert.equal(typeof body(r).error, "string");
    }
  });

  it("buscar al dueño principal devuelve la previsualización bloqueada", async () => {
    const { port } = await build();
    const r = await previewApi(port, SUPER, asAdmin("dueno"), { email: SUPER_EMAIL });
    assert.equal((body(r).preview as { blocked: { status: number } }).blocked.status, 403);
  });
});

describe("POST /api/admin/eliminar-datos", () => {
  it("sin la palabra de confirmación (o en minúscula) no ejecuta: 400", async () => {
    const { port, world } = await build();
    for (const raw of [{ phone: PHONE }, { phone: PHONE, confirm: "eliminar" }, { phone: PHONE, confirm: "SI" }, { phone: PHONE, confirm: true }, null, "texto"]) {
      const r = await executeApi(port, SUPER, asAdmin("dueno"), raw);
      assert.equal(r.status, 400, JSON.stringify(raw));
    }
    assert.equal(usersLeft(world, MARTA.userId), 1);
  });

  it("el cuerpo es estricto: campos de más, o teléfono y email juntos, se rechazan", async () => {
    const { port, world } = await build();
    const base = { phone: PHONE, confirm: "ELIMINAR" };
    for (const raw of [{ ...base, userId: "dueno" }, { ...base, email: MARTA.email }, { ...base, channel: "autoservicio" }, { confirm: "ELIMINAR" }]) {
      assert.equal((await executeApi(port, SUPER, asAdmin("dueno"), raw)).status, 400, JSON.stringify(raw));
    }
    assert.equal(usersLeft(world, MARTA.userId), 1);
    assert.equal(executeBodySchema.safeParse({ ...base }).success, true);
  });

  it("con la confirmación elimina, devuelve conteos y deja el canal elegido en el registro", async () => {
    const { port, world } = await build();
    const r = await executeApi(port, SUPER, asAdmin("dueno"), { email: MARTA.email, channel: "admin", confirm: "ELIMINAR" }, world.files);
    assert.equal(r.status, 200);
    const result = body(r).result as { status: string; total: number };
    assert.equal(result.status, "completed");
    assert.equal(result.total, 24);
    assert.equal(body(r).note, null);
    assert.equal(usersLeft(world, MARTA.userId), 0);
    assert.deepEqual(world.files.deleted, [MARTA.photo]);
    assert.equal((world.db.raw.prepare(`SELECT channel FROM data_deletion_requests`).get() as { channel: string }).channel, "admin");
    const list = await previewApi(port, SUPER, asAdmin("dueno"), {});
    assert.equal((body(list).recent as unknown[]).length, 1);
  });

  it("el canal por defecto es 'email'", async () => {
    const { port, world } = await build();
    await executeApi(port, SUPER, asAdmin("dueno"), { phone: PHONE, confirm: "ELIMINAR" }, world.files);
    assert.equal((world.db.raw.prepare(`SELECT channel FROM data_deletion_requests`).get() as { channel: string }).channel, "email");
  });

  it("sin bucket: el resultado es 'partial' y la respuesta lo avisa", async () => {
    const { port } = await build();
    const r = await executeApi(port, SUPER, asAdmin("dueno"), { phone: PHONE, confirm: "ELIMINAR" }, null);
    assert.equal(r.status, 200);
    assert.equal((body(r).result as { status: string }).status, "partial");
    assert.match(String(body(r).note), /fotos/);
  });

  it("otro dueño, gerente o cajero: 403 y no se borra nada", async () => {
    const { port, world } = await build();
    for (const id of ["socio", "gerente1", "cajero1"]) {
      const raw = { phone: PHONE, confirm: "ELIMINAR" };
      assert.equal((await executeApi(port, NOT_SUPER, asAdmin(id), raw)).status, 403, id);
      assert.equal((await executeApi(port, SUPER, asAdmin(id), raw)).status, 403, `${id} (capa de datos)`);
    }
    assert.equal(usersLeft(world, MARTA.userId), 1);
    assert.equal((world.db.raw.prepare(`SELECT count(*) AS n FROM data_deletion_requests`).get() as { n: number }).n, 0);
  });

  it("no se puede eliminar al dueño principal: 403", async () => {
    const { port, world } = await build();
    const r = await executeApi(port, SUPER, asAdmin("dueno"), { email: SUPER_EMAIL, confirm: "ELIMINAR" });
    assert.equal(r.status, 403);
    assert.equal(usersLeft(world, "dueno"), 1);
  });
});

describe("GET y POST /api/account/delete", () => {
  it("elegibilidad: el cliente puede; el repartidor y el dueño principal no, con el motivo", async () => {
    const { port } = await build();
    assert.deepEqual((await eligibilityApi(port, { userId: "u-marta", role: "cliente" })).body, { canDelete: true, reason: null });
    const courier = body(await eligibilityApi(port, { userId: "u-pedro", role: "repartidor" }));
    assert.equal(courier.canDelete, false);
    assert.match(String(courier.reason), /repartidores/);
    const principal = body(await eligibilityApi(port, { userId: "dueno", role: "admin" }));
    assert.equal(principal.canDelete, false);
    assert.match(String(principal.reason), /dueño principal/);
  });

  it("el último dueño activo no puede: mensaje claro", async () => {
    const { port, world } = await build(null);
    world.db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = 'dueno'`).run();
    const r = body(await eligibilityApi(port, { userId: "socio", role: "admin" }));
    assert.equal(r.canDelete, false);
    assert.match(String(r.reason), /único dueño activo/);
  });

  it("el cuerpo exige contraseña y la palabra ELIMINAR; el usuario sale de la sesión, no del cuerpo", async () => {
    const { port, world } = await build();
    const bad: unknown[] = [
      {}, { password: "", confirm: "ELIMINAR" }, { password: PASSWORD }, { password: PASSWORD, confirm: "eliminar" },
      { password: PASSWORD, confirm: "ELIMINAR", userId: "u-beto" }, { password: "x".repeat(129), confirm: "ELIMINAR" }, null,
    ];
    for (const raw of bad) assert.equal((await deleteOwnApi(port, { userId: "u-marta", role: "cliente" }, raw)).status, 400, JSON.stringify(raw));
    assert.equal(usersLeft(world, "u-marta"), 1);
    assert.equal(usersLeft(world, "u-beto"), 1);
  });

  it("contraseña incorrecta: 400 y no borra; correcta: 200 { ok: true } y borra solo a quien está en la sesión", async () => {
    const { port, world } = await build();
    const wrong = await deleteOwnApi(port, { userId: "u-marta", role: "cliente" }, { password: "no-es-la-clave", confirm: "ELIMINAR" });
    assert.equal(wrong.status, 400);
    assert.equal(body(wrong).error, "La contraseña no es correcta.");
    assert.equal(usersLeft(world, "u-marta"), 1);
    const ok = await deleteOwnApi(port, { userId: "u-marta", role: "cliente" }, { password: PASSWORD, confirm: "ELIMINAR" });
    assert.deepEqual(ok, { status: 200, body: { ok: true } });
    assert.equal(usersLeft(world, "u-marta"), 0);
    assert.equal(usersLeft(world, "u-beto"), 1);
    assert.equal((world.db.raw.prepare(`SELECT channel FROM data_deletion_requests`).get() as { channel: string }).channel, "autoservicio");
  });

  it("repartidor y rol desconocido: 403 sin llegar a la capa de datos", async () => {
    const { port, world } = await build();
    assert.equal((await deleteOwnApi(port, { userId: "u-pedro", role: "repartidor" }, { password: PASSWORD, confirm: "ELIMINAR" })).status, 403);
    assert.equal((await deleteOwnApi(port, { userId: "u-pedro", role: "otro" }, { password: PASSWORD, confirm: "ELIMINAR" })).status, 403);
    assert.equal(usersLeft(world, "u-pedro"), 1);
  });

  it("el dueño principal: 403 aun con la contraseña correcta", async () => {
    const { port, world } = await build();
    world.db.raw
      .prepare(`INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES ('a-dueno', 'dueno', 'credential', 'dueno', ?, 'x', 'x')`)
      .run(await hashPassword(world, PASSWORD));
    const r = await deleteOwnApi(port, { userId: "dueno", role: "admin" }, { password: PASSWORD, confirm: "ELIMINAR" });
    assert.equal(r.status, 403);
    assert.equal(usersLeft(world, "dueno"), 1);
  });
});

describe("cookies de sesión al eliminar la cuenta", () => {
  it("se vencen solo las de Better Auth (prefijo opsyn, con o sin __Secure-)", () => {
    assert.deepEqual(
      authCookiesToExpire(["__Secure-opsyn.session_token", "opsyn.session_data", "__Secure-opsyn.dont_remember", "theme", "__Host-x", "otro-opsyn.x", "opsyn-sin-punto"]),
      ["__Secure-opsyn.session_token", "opsyn.session_data", "__Secure-opsyn.dont_remember"],
    );
    assert.deepEqual(authCookiesToExpire([]), []);
  });
});
