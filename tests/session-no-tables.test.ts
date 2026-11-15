/**
 * HIGH de la revisión (etapa 3): en d1 el cliente de sesión no puede ejecutar planes, porque
 * sin RLS correrían como admin. Un cliente no puede leer pedidos de otro por esa vía.
 * Además: bloqueo y cambio de rol toman efecto en el request siguiente, y orígenes con www.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFakeClient } from "../src/lib/demo/fake-client.ts";
import { rejectTableAccess, NO_TABLES_ERROR } from "../src/lib/session-no-tables.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth } from "../src/lib/data/auth.ts";
import {
  createCourierUserWith,
  courierSessionCookiesWith,
  sessionUserWith,
  trustedOriginsFor,
} from "../src/lib/data/session.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const SECRET = crypto.randomUUID() + crypto.randomUUID();

const sessionClient = () =>
  createFakeClient({
    execute: rejectTableAccess,
    getUser: async () => ({ id: "cliente-a", app_metadata: { role: "cliente" } }) as never,
    signIn: async () => ({ error: null }),
    signOut: async () => {},
  });

describe("cliente de sesión con D1 sin acceso a tablas", () => {
  it("no lee pedidos de otro cliente (ni ningún pedido)", async () => {
    const res = await sessionClient().from("orders").select("*").eq("client_id", "cliente-b");
    assert.equal(res.data, null);
    assert.equal(res.error?.message, NO_TABLES_ERROR);
  });

  it("tampoco escribe ni borra", async () => {
    const c = sessionClient();
    const ins = await c.from("orders").insert({ client_id: "cliente-b" } as never);
    const del = await c.from("clients").delete().eq("id", "cliente-b");
    assert.ok(ins.error && del.error);
  });

  it("bloqueo y cambio de rol valen en el request siguiente", async () => {
    const db = createTestDb();
    const auth = createAuth({ database: db.raw, secret: SECRET, baseURL: BASE });
    const id = await createCourierUserWith(db, "R");
    const cookies = (await courierSessionCookiesWith(auth, id)) ?? [];
    const headers = new Headers({ cookie: cookies.map((c) => c.split(";")[0]).join("; ") });
    assert.equal((await sessionUserWith(auth, headers))?.app_metadata.role, "repartidor");
    db.raw.prepare(`UPDATE "user" SET role = 'cliente' WHERE id = ?`).run(id);
    assert.equal((await sessionUserWith(auth, headers))?.app_metadata.role, "cliente");
    db.raw.prepare(`UPDATE "user" SET banned = 1 WHERE id = ?`).run(id);
    assert.equal(await sessionUserWith(auth, headers), null);
  });

  it("orígenes confiables: dominio y www, nada más", () => {
    assert.deepEqual(trustedOriginsFor(BASE), [BASE, "https://www.opsyndely.la-gambeta.com"]);
    assert.deepEqual(trustedOriginsFor("https://www.opsyndely.la-gambeta.com"), [BASE, "https://www.opsyndely.la-gambeta.com"]);
  });

  it("conserva el puerto (prueba local con wrangler dev)", () => {
    assert.deepEqual(trustedOriginsFor("http://localhost:8787"), ["http://localhost:8787", "http://www.localhost:8787"]);
  });
});
