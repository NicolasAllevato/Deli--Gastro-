import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_S,
  CONSENT_VERSION,
  acceptAll,
  essentialOnly,
  parseConsent,
  readConsentFromCookieHeader,
  serializeConsentCookie,
} from "../src/lib/consent/consentCore.ts";

const NOW = new Date("2026-10-14T12:00:00.000Z");

describe("consentimiento de cookies", () => {
  it("acceptAll activa preferencias y analítica", () => {
    const c = acceptAll(NOW);
    assert.equal(c.preferences, true);
    assert.equal(c.analytics, true);
    assert.equal(c.version, CONSENT_VERSION);
    assert.equal(c.decidedAt, NOW.toISOString());
  });

  it("essentialOnly deja todo lo opcional apagado", () => {
    const c = essentialOnly(NOW);
    assert.equal(c.preferences, false);
    assert.equal(c.analytics, false);
  });

  it("serializa y vuelve a leer la misma elección", () => {
    const cookie = serializeConsentCookie({ ...essentialOnly(NOW), preferences: true });
    assert.match(cookie, new RegExp(`^${CONSENT_COOKIE}=`));
    assert.match(cookie, new RegExp(`Max-Age=${CONSENT_MAX_AGE_S}`));
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /SameSite=Lax/);
    const header = cookie.split(";")[0];
    const back = readConsentFromCookieHeader(`otra=1; ${header}`);
    assert.deepEqual(back, { ...essentialOnly(NOW), preferences: true });
  });

  it("sin cookie no hay decisión tomada", () => {
    assert.equal(readConsentFromCookieHeader(""), null);
    assert.equal(readConsentFromCookieHeader("otra=1"), null);
  });

  it("ignora valores corruptos o manipulados", () => {
    assert.equal(parseConsent("no-es-json"), null);
    assert.equal(parseConsent(encodeURIComponent(JSON.stringify({ preferences: "si" }))), null);
    assert.equal(parseConsent(encodeURIComponent(JSON.stringify([1, 2]))), null);
  });

  it("una versión vieja obliga a volver a preguntar", () => {
    const old = encodeURIComponent(JSON.stringify({ ...acceptAll(NOW), version: CONSENT_VERSION - 1 }));
    assert.equal(parseConsent(old), null);
  });
});
