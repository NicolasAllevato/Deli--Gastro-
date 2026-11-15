/** Turnstile en "olvidé mi contraseña": sin token no se manda nada; el login no lo pide. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { createAuth } from "../src/lib/data/auth.ts";

const BASE = "https://opsyndely.la-gambeta.com";
const SECRET = crypto.randomUUID() + crypto.randomUUID();

const post = (auth: ReturnType<typeof createAuth>, path: string, body: unknown, extra: Record<string, string> = {}) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "9.9.9.9", ...extra },
      body: JSON.stringify(body),
    }),
  );

describe("captcha (Turnstile) en recuperación", () => {
  it("con secreto configurado, pedir recuperación sin token responde 400 y no envía", async () => {
    let sent = 0;
    const auth = createAuth({
      database: createTestDb().raw, secret: SECRET, baseURL: BASE,
      turnstileSecret: "1x0000000000000000000000000000000AA",
      sendResetPassword: async () => { sent++; },
    });
    const r = await post(auth, "/request-password-reset", { email: "a@b.com", redirectTo: "/restablecer" });
    assert.equal(r.status, 400);
    assert.equal(sent, 0);
  });

  it("el login no exige captcha", async () => {
    const auth = createAuth({ database: createTestDb().raw, secret: SECRET, baseURL: BASE, turnstileSecret: "x" });
    const r = await post(auth, "/sign-in/email", { email: "a@b.com", password: "xxxxxxxxxxxx" });
    assert.equal(r.status, 401);
  });

  it("sin secreto (tests/local) la recuperación sigue respondiendo 200", async () => {
    const auth = createAuth({ database: createTestDb().raw, secret: SECRET, baseURL: BASE });
    const r = await post(auth, "/request-password-reset", { email: "a@b.com", redirectTo: "/restablecer" });
    assert.equal(r.status, 200);
  });
});
