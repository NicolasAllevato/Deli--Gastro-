/**
 * Better Auth (inactivo) contra el esquema real D1 en node:sqlite:
 * cookies seguras, rol no escribible (G18), mismo error para usuario
 * inexistente o clave mala, rate limit de login.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth, AUTH_COOKIE_PREFIX } from "../src/lib/data/auth.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const SECRET = crypto.randomUUID() + crypto.randomUUID();

function setup() {
  const db = createTestDb();
  const auth = createAuth({ database: db.raw, secret: SECRET, baseURL: BASE });
  return { db, auth };
}

const post = (auth: ReturnType<typeof createAuth>, path: string, body: unknown, ip = "1.1.1.1") =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    }),
  );

describe("Better Auth sobre D1", () => {
  it("exige secreto de 32+ caracteres", () => {
    assert.throws(() => createAuth({ database: null, secret: "corto", baseURL: BASE }));
    assert.throws(() => createAuth({ database: null, secret: undefined, baseURL: BASE }));
  });

  it("sign-up ignora/rechaza role y deja 'cliente' (G18)", async () => {
    const { db, auth } = setup();
    const res = await post(auth, "/sign-up/email", { email: "a@x.test", password: "clave-segura-123", name: "A", role: "admin" });
    const row = db.raw.prepare(`SELECT role FROM "user" WHERE email = 'a@x.test'`).get() as { role: string } | undefined;
    if (res.ok) assert.equal(row?.role, "cliente");
    else assert.equal(row, undefined, "si rechaza, no crea usuario");
  });

  it("update-user no permite escalar a admin (G18)", async () => {
    const { db, auth } = setup();
    await post(auth, "/sign-up/email", { email: "b@x.test", password: "clave-segura-123", name: "B" });
    const login = await post(auth, "/sign-in/email", { email: "b@x.test", password: "clave-segura-123" });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    await auth.handler(
      new Request(`${BASE}/api/auth/update-user`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, cookie },
        body: JSON.stringify({ role: "admin" }),
      }),
    );
    const row = db.raw.prepare(`SELECT role FROM "user" WHERE email = 'b@x.test'`).get() as { role: string };
    assert.equal(row.role, "cliente");
  });

  it("cookie de sesión HttpOnly, Secure, SameSite=Lax y con prefijo", async () => {
    const { auth } = setup();
    await post(auth, "/sign-up/email", { email: "c@x.test", password: "clave-segura-123", name: "C" });
    const login = await post(auth, "/sign-in/email", { email: "c@x.test", password: "clave-segura-123" });
    const sc = login.headers.get("set-cookie") ?? "";
    assert.match(sc, new RegExp(`__Secure-${AUTH_COOKIE_PREFIX}\\.session_token=`));
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /Secure/i);
    assert.match(sc, /SameSite=Lax/i);
  });

  it("mismo error para usuario inexistente y clave mala", async () => {
    const { auth } = setup();
    await post(auth, "/sign-up/email", { email: "d@x.test", password: "clave-segura-123", name: "D" });
    const wrong = await post(auth, "/sign-in/email", { email: "d@x.test", password: "otra-clave-999" }, "2.2.2.2");
    const ghost = await post(auth, "/sign-in/email", { email: "nadie@x.test", password: "otra-clave-999" }, "3.3.3.3");
    assert.equal(wrong.status, ghost.status);
    assert.deepEqual(await wrong.json(), await ghost.json());
  });

  it("rate limit de login: el 6º intento en 60 s devuelve 429", async () => {
    const { auth } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await post(auth, "/sign-in/email", { email: "e@x.test", password: "nada-nada-1" }, "9.9.9.9")).status);
    }
    assert.equal(statuses.at(-1), 429);
  });

  it("sign-up con el email de un admin copiado: respuesta indistinguible, sin cuenta y sin tocar el rol", async () => {
    const { db, auth } = setup();
    // Usuario copiado de Supabase Auth (scripts/copiar-usuarios-d1.mjs): fila en "user", sin cuenta con contraseña.
    db.raw.prepare(`INSERT INTO "user" (id, email, role, emailVerified, createdAt, updatedAt) VALUES ('u-adm', 'admin@x.test', 'admin', 1, 'x', 'x')`).run();
    const existente = await post(auth, "/sign-up/email", { email: "admin@x.test", password: "clave-segura-123", name: "Intruso" }, "4.4.4.4");
    const nuevo = await post(auth, "/sign-up/email", { email: "otro@x.test", password: "clave-segura-123", name: "Intruso" }, "5.5.5.5");
    assert.equal(existente.status, nuevo.status, "mismo código: no revela si el email existe");
    const shape = (j: { user?: Record<string, unknown> }) => Object.keys(j.user ?? {}).sort();
    assert.deepEqual(shape(await existente.json()), shape(await nuevo.json()));
    const cuentas = db.raw.prepare(`SELECT count(*) n FROM "account" WHERE userId = 'u-adm'`).get() as { n: number };
    assert.equal(cuentas.n, 0, "no se crea ni se vincula una contraseña sobre el usuario copiado");
    const adm = db.raw.prepare(`SELECT role, name FROM "user" WHERE id = 'u-adm'`).get() as { role: string; name: string };
    assert.equal(adm.role, "admin");
    assert.notEqual(adm.name, "Intruso");
  });

  it("rechaza orígenes no confiables (CSRF)", async () => {
    const { auth } = setup();
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example", cookie: "x=1" },
        body: JSON.stringify({ email: "a@x.test", password: "clave-segura-123" }),
      }),
    );
    assert.equal(res.status, 403);
  });
});
