import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSignupMessage, signupBodySchema } from "../src/lib/whatsapp/embedded-signup.ts";

const FB = "https://www.facebook.com";

function message(payload: unknown, origin = FB) {
  return { origin, data: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

describe("parseSignupMessage", () => {
  it("extrae los ids cuando Meta termina el alta", () => {
    const result = parseSignupMessage(
      message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "1110001", waba_id: "2220002" } }),
    );
    assert.deepEqual(result, { kind: "finish", phoneNumberId: "1110001", wabaId: "2220002" });
  });

  it("detecta la cancelación", () => {
    const result = parseSignupMessage(
      message({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } }),
    );
    assert.deepEqual(result, { kind: "cancel", step: "PHONE_NUMBER_SETUP" });
  });

  it("ignora mensajes de otros orígenes", () => {
    const evil = message(
      { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "1110001", waba_id: "2220002" } },
      "https://evil.example.com",
    );
    assert.equal(parseSignupMessage(evil), null);
    const lookalike = { ...evil, origin: "https://facebook.com.evil.example" };
    assert.equal(parseSignupMessage(lookalike), null);
  });

  it("ignora JSON inválido, otros tipos e ids no numéricos", () => {
    assert.equal(parseSignupMessage(message("no es json")), null);
    assert.equal(parseSignupMessage(message({ type: "OTRO", event: "FINISH" })), null);
    assert.equal(
      parseSignupMessage(
        message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "abc", waba_id: "2" } }),
      ),
      null,
    );
    assert.equal(parseSignupMessage({ origin: FB, data: { objeto: true } }), null);
  });
});

describe("signupBodySchema", () => {
  const ok = { code: "AQB123", phoneNumberId: "1110001", wabaId: "2220002", pin: "123456" };

  it("acepta un cuerpo válido", () => {
    assert.equal(signupBodySchema.safeParse(ok).success, true);
  });

  it("rechaza PIN inválido, ids no numéricos, código vacío y campos extra", () => {
    assert.equal(signupBodySchema.safeParse({ ...ok, pin: "12345" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...ok, phoneNumberId: "x1" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...ok, code: "" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...ok, extra: 1 }).success, false);
  });
});
