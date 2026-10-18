import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sameText, verifyChallenge } from "../workers/whatsapp-bot/src/verify.ts";

describe("worker whatsapp-bot: verificación del webhook", () => {
  const params = (q: string) => new URLSearchParams(q);

  it("devuelve el desafío con el token correcto", () => {
    assert.equal(verifyChallenge(params("hub.mode=subscribe&hub.verify_token=abc&hub.challenge=42"), "abc"), "42");
  });

  it("rechaza token distinto, modo distinto o sin token configurado", () => {
    assert.equal(verifyChallenge(params("hub.mode=subscribe&hub.verify_token=xyz&hub.challenge=42"), "abc"), null);
    assert.equal(verifyChallenge(params("hub.mode=unsubscribe&hub.verify_token=abc&hub.challenge=42"), "abc"), null);
    assert.equal(verifyChallenge(params("hub.mode=subscribe&hub.verify_token=&hub.challenge=42"), null), null);
  });

  it("sameText compara longitud y contenido", () => {
    assert.equal(sameText("abc", "abc"), true);
    assert.equal(sameText("abc", "abd"), false);
    assert.equal(sameText("abc", "abcd"), false);
  });
});
