/**
 * /admin/legal con D1: la lista de aceptaciones sale de D1 (antes solo la rama de Supabase la leía y con DATA_BACKEND=d1
 * el panel no mostraba nada). Capa de datos real sobre node:sqlite + agrupación pura.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { ForbiddenError, type Actor } from "../src/lib/data/actor.ts";
import { listAllLegal } from "../src/lib/data/legal.ts";
import { deleteSubjectData } from "../src/lib/data/data-deletion.ts";
import { LEGAL_DOCUMENTS } from "../src/lib/legal/documents.ts";
import { LEGAL_LIST_MAX_ROWS, groupLegalUsers, legalDocumentsView } from "../src/lib/legal/admin-list.ts";
import { seedStaff, setup } from "./helpers/deletion-world.ts";

const [TERMINOS, PRIVACIDAD] = LEGAL_DOCUMENTS;
const admin: Actor = { kind: "admin", userId: "dueno" };
const system: Actor = { kind: "system", reason: "test" };

function seed() {
  const db = createTestDb();
  const now = "2026-11-10T12:00:00.000Z";
  const user = db.raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`);
  user.run("u-ana", "ana@x.test", "cliente", now, now);
  user.run("u-beto", "beto@x.test", "cliente", now, now);
  user.run("u-vieja", "vieja@x.test", "cliente", now, now);
  const acc = db.raw.prepare(`INSERT INTO legal_acceptances (id, user_id, email, role, document, version, accepted_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  acc.run("1", "u-ana", "ana@x.test", "cliente", TERMINOS.id, TERMINOS.version, "2026-11-01T10:00:00.000Z", "10.0.0.1");
  acc.run("2", "u-ana", "ana@x.test", "cliente", PRIVACIDAD.id, PRIVACIDAD.version, "2026-11-01T10:01:00.000Z", "10.0.0.2");
  acc.run("3", "u-beto", "beto@x.test", "cliente", TERMINOS.id, TERMINOS.version, "2026-11-02T10:00:00.000Z", "10.0.0.3");
  acc.run("4", "u-vieja", "vieja@x.test", "cliente", TERMINOS.id, "2020-01-01", "2026-10-01T10:00:00.000Z", "10.0.0.4"); // versión vieja
  acc.run("5", null, null, "cliente", TERMINOS.id, TERMINOS.version, "2026-11-03T10:00:00.000Z", null); // constancia anonimizada
  return db;
}

describe("listAllLegal (D1)", () => {
  it("lista las aceptaciones de todos de la más reciente a la más vieja, sin las anonimizadas", async () => {
    const rows = await listAllLegal(seed(), admin);
    assert.deepEqual(rows.map((r) => r.accepted_at), [
      "2026-11-02T10:00:00.000Z", "2026-11-01T10:01:00.000Z", "2026-11-01T10:00:00.000Z", "2026-10-01T10:00:00.000Z",
    ]);
    assert.ok(rows.every((r) => r.user_id));
    assert.deepEqual(Object.keys(rows[0]).sort(), ["accepted_at", "document", "email", "ip", "role", "user_id", "version"]);
  });

  it("solo personal: cliente, repartidor y anónimo reciben ForbiddenError; el sistema y el admin pueden", async () => {
    const db = seed();
    const denied: Actor[] = [{ kind: "cliente", userId: "u-ana" }, { kind: "repartidor", userId: "r" }, { kind: "anon" }];
    for (const actor of denied) await assert.rejects(listAllLegal(db, actor), ForbiddenError, actor.kind);
    assert.equal((await listAllLegal(db, system)).length, 4);
  });

  it("el tope se respeta (y nunca pasa de 5000)", async () => {
    const db = seed();
    assert.equal((await listAllLegal(db, admin, 2)).length, 2);
    assert.equal((await listAllLegal(db, admin, 0)).length, 1, "mínimo 1");
    assert.equal(LEGAL_LIST_MAX_ROWS, 5000);
  });
});

describe("groupLegalUsers", () => {
  it("agrupa por usuario, marca completo solo con la versión vigente de los dos documentos y toma email, rol e IP de la última aceptación", async () => {
    const users = groupLegalUsers(await listAllLegal(seed(), admin));
    const byId = Object.fromEntries(users.map((u) => [u.userId, u]));
    assert.equal(users.length, 3);
    assert.equal(byId["u-ana"].complete, true);
    assert.deepEqual(Object.keys(byId["u-ana"].accepted).sort(), ["privacidad", "terminos"]);
    assert.equal(byId["u-ana"].lastIp, "10.0.0.2", "la de la aceptación más reciente");
    assert.equal(byId["u-beto"].complete, false, "falta privacidad");
    assert.deepEqual(Object.keys(byId["u-beto"].accepted), ["terminos"]);
    assert.equal(byId["u-vieja"].complete, false, "aceptó una versión vieja");
    assert.deepEqual(byId["u-vieja"].accepted, {});
    assert.equal(byId["u-ana"].email, "ana@x.test");
    assert.equal(byId["u-ana"].role, "cliente");
  });

  it("sin filas, lista vacía; los documentos que se muestran son los vigentes", () => {
    assert.deepEqual(groupLegalUsers([]), []);
    assert.deepEqual(legalDocumentsView().map((d) => d.id), LEGAL_DOCUMENTS.map((d) => d.id));
  });
});

describe("el panel y la baja de datos", () => {
  it("tras eliminar a un usuario su constancia sigue en la base pero ya no aparece en el panel", async () => {
    const world = setup();
    seedStaff(world);
    const now = "2026-11-10T12:00:00.000Z";
    world.db.raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES ('u-ana', 'ana@x.test', 'cliente', ?, ?)`).run(now, now);
    world.db.raw
      .prepare(`INSERT INTO legal_acceptances (id, user_id, email, role, document, version, ip) VALUES ('a1', 'u-ana', 'ana@x.test', 'cliente', ?, ?, '10.0.0.9')`)
      .run(TERMINOS.id, TERMINOS.version);
    assert.equal(groupLegalUsers(await listAllLegal(world.db, admin)).length, 1);
    const r = await deleteSubjectData(world.db, admin, { email: "ana@x.test", channel: "email" }, world.opts);
    assert.ok(r.ok);
    assert.deepEqual(groupLegalUsers(await listAllLegal(world.db, admin)), []);
    const kept = world.db.raw.prepare(`SELECT user_id, email, ip, document, version FROM legal_acceptances WHERE id = 'a1'`).get() as Record<string, unknown>;
    assert.equal(kept.user_id, null);
    assert.equal(kept.ip, null);
    assert.equal(kept.document, TERMINOS.id);
  });
});
