/**
 * Etapa 3 del corte: sesiones de Better Auth sobre el esquema real de D1 (node:sqlite).
 * Sesión de repartidor solo desde el servidor, bloqueo que corta sesiones, rol validado,
 * marca legal escrita solo por el servidor, alta pública cerrada y recuperación de un uso.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth } from "../src/lib/data/auth.ts";
import {
  toSessionUser,
  sessionUserWith,
  setLegalVersionWith,
  createCourierUserWith,
  setCourierBlockedWith,
  courierSessionCookiesWith,
} from "../src/lib/data/session.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const SECRET = crypto.randomUUID() + crypto.randomUUID();

function setup(extra: Partial<Parameters<typeof createAuth>[0]> = {}) {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: SECRET, baseURL: BASE, ...extra });
  return { db, auth };
}

const cookieHeader = (setCookies: string[]) => setCookies.map((c) => c.split(";")[0]).join("; ");

function insertUser(db: ReturnType<typeof createTestDb>, id: string, role: string) {
  const now = new Date().toISOString();
  db.raw
    .prepare(`INSERT INTO "user" (id, name, email, emailVerified, role, createdAt, updatedAt) VALUES (?, 'X', ?, 1, ?, ?, ?)`)
    .run(id, `${id}@x.test`, role, now, now);
}

describe("sesiones Better Auth (etapa 3)", () => {
  it("toSessionUser: rol desconocido queda cliente y bloqueado no tiene sesión", () => {
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "staff" })?.app_metadata.role, "cliente");
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "admin" })?.app_metadata.role, "admin");
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "admin", banned: 1 }), null);
    assert.equal(toSessionUser({ id: "a", email: "a@x", role: "cliente", legal_version: "v1" })?.app_metadata.legal_version, "v1");
  });

  it("repartidor: sesión desde el servidor, válida para getSession", async () => {
    const { db, auth } = setup();
    const id = await createCourierUserWith(db, "Juan");
    const cookies = await courierSessionCookiesWith(auth, id);
    assert.ok(cookies && cookies.length > 0);
    assert.match(cookies.join(";"), /HttpOnly/i);
    const user = await sessionUserWith(auth, new Headers({ cookie: cookieHeader(cookies) }));
    assert.equal(user?.id, id);
    assert.equal(user?.app_metadata.role, "repartidor");
    const accounts = db.raw.prepare(`SELECT count(*) AS n FROM "account" WHERE userId = ?`).get(id) as { n: number };
    assert.equal(accounts.n, 0, "el repartidor no tiene contraseña");
  });

  it("el endpoint de sesión de repartidor no existe por HTTP", async () => {
    const { db, auth } = setup();
    const id = await createCourierUserWith(db, "Juan");
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/opsyn/courier-session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ userId: id }),
      }),
    );
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("no abre sesión de repartidor a un admin ni a un repartidor bloqueado", async () => {
    const { db, auth } = setup();
    insertUser(db, "admin-1", "admin");
    assert.equal(await courierSessionCookiesWith(auth, "admin-1"), null);
    const id = await createCourierUserWith(db, "Ana");
    assert.ok(await setCourierBlockedWith(db, id, true));
    assert.equal(await courierSessionCookiesWith(auth, id), null);
  });

  it("bloquear corta las sesiones abiertas", async () => {
    const { db, auth } = setup();
    const id = await createCourierUserWith(db, "Pepe");
    const cookies = (await courierSessionCookiesWith(auth, id)) ?? [];
    const headers = new Headers({ cookie: cookieHeader(cookies) });
    assert.equal((await sessionUserWith(auth, headers))?.id, id);
    assert.ok(await setCourierBlockedWith(db, id, true));
    assert.equal(await sessionUserWith(auth, headers), null);
  });

  it("setCourierBlocked no toca usuarios que no son repartidores", async () => {
    const { db } = setup();
    insertUser(db, "admin-2", "admin");
    assert.equal(await setCourierBlockedWith(db, "admin-2", true), false);
    const row = db.raw.prepare(`SELECT banned FROM "user" WHERE id = 'admin-2'`).get() as { banned: number };
    assert.equal(row.banned, 0);
  });

  it("marca legal: la escribe el servidor y update-user no puede", async () => {
    const { db, auth } = setup({ allowSignUp: true });
    const post = (path: string, body: unknown, cookie = "") =>
      auth.handler(new Request(`${BASE}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, cookie },
        body: JSON.stringify(body),
      }));
    await post("/sign-up/email", { email: "l@x.test", password: "clave-segura-123", name: "L" });
    const login = await post("/sign-in/email", { email: "l@x.test", password: "clave-segura-123" });
    const cookie = cookieHeader(login.headers.getSetCookie());
    await post("/update-user", { legal_version: "trucha", banned: false }, cookie);
    const before = db.raw.prepare(`SELECT id, legal_version FROM "user" WHERE email = 'l@x.test'`).get() as { id: string; legal_version: string | null };
    assert.equal(before.legal_version, null);
    assert.ok(await setLegalVersionWith(db, before.id, "2026-10"));
    const user = await sessionUserWith(auth, new Headers({ cookie }));
    assert.equal(user?.app_metadata.legal_version, "2026-10");
  });

  it("sin allowSignUp el alta pública está cerrada", async () => {
    const { db, auth } = setup();
    await auth.handler(new Request(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "n@x.test", password: "clave-segura-123", name: "N" }),
    }));
    const row = db.raw.prepare(`SELECT count(*) AS n FROM "user"`).get() as { n: number };
    assert.equal(row.n, 0);
  });

  it("recuperación: mismo resultado exista o no el email; link de 15 min y un solo uso", async () => {
    const sent: string[] = [];
    const { db, auth } = setup({ sendResetPassword: async (_to, url) => void sent.push(url) });
    insertUser(db, "cli-1", "cliente");
    const req = (email: string, ip: string) =>
      auth.handler(new Request(`${BASE}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ip },
        body: JSON.stringify({ email, redirectTo: "/restablecer" }),
      }));
    const known = await req("cli-1@x.test", "9.9.9.1");
    const ghost = await req("nadie@x.test", "9.9.9.2");
    assert.equal(known.status, ghost.status);
    assert.deepEqual(await known.json(), await ghost.json());
    assert.equal(sent.length, 1);

    const v = db.raw.prepare(`SELECT identifier, expiresAt FROM "verification"`).get() as { identifier: string; expiresAt: string };
    const ttl = new Date(v.expiresAt).getTime() - Date.now();
    assert.ok(ttl <= 15 * 60_000 + 5_000 && ttl > 14 * 60_000, `ttl ${ttl}`);

    const token = v.identifier.replace(/^reset-password:/, "");
    const reset = (ip: string) =>
      auth.handler(new Request(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ip },
        body: JSON.stringify({ newPassword: "otra-clave-segura-1", token }),
      }));
    assert.equal((await reset("9.9.9.3")).status, 200);
    assert.notEqual((await reset("9.9.9.4")).status, 200, "el link no sirve dos veces");
  });
});
