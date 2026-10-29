import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSignupExtras,
  parseSignupMessage,
  signupBodySchema,
} from "../src/lib/whatsapp/embedded-signup.ts";

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

  it("trata FINISH_ONLY_WABA igual que FINISH cuando trae los dos ids", () => {
    const result = parseSignupMessage(
      message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_ONLY_WABA", data: { phone_number_id: "1110001", waba_id: "2220002" } }),
    );
    assert.deepEqual(result, { kind: "finish", phoneNumberId: "1110001", wabaId: "2220002" });
  });

  it("FINISH sin phone_number_id no es válido", () => {
    assert.equal(
      parseSignupMessage(message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "2220002" } })),
      null,
    );
  });

  it("coexistencia: FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING usa solo el waba_id", () => {
    const result = parseSignupMessage(
      message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "2220002" } }),
    );
    assert.deepEqual(result, { kind: "finish_coexistence", wabaId: "2220002" });
  });

  it("coexistencia sin waba_id válido se ignora", () => {
    for (const data of [{}, { waba_id: "abc" }, { waba_id: 123456 }]) {
      assert.equal(
        parseSignupMessage(message({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data })),
        null,
      );
    }
  });

  it("detecta la cancelación", () => {
    const result = parseSignupMessage(
      message({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } }),
    );
    assert.deepEqual(result, { kind: "cancel", step: "PHONE_NUMBER_SETUP" });
  });

  it("cancelación sin paso informado", () => {
    assert.deepEqual(parseSignupMessage(message({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL" })), { kind: "cancel", step: null });
  });

  it("ignora eventos desconocidos", () => {
    assert.equal(parseSignupMessage(message({ type: "WA_EMBEDDED_SIGNUP", event: "OTRO", data: { waba_id: "2220002" } })), null);
  });

  it("ignora mensajes de otros orígenes", () => {
    const evil = message(
      { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "2220002" } },
      "https://evil.example.com",
    );
    assert.equal(parseSignupMessage(evil), null);
    assert.equal(parseSignupMessage({ ...evil, origin: "https://facebook.com.evil.example" }), null);
    assert.equal(parseSignupMessage({ ...evil, origin: "http://www.facebook.com" }), null);
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

describe("buildSignupExtras", () => {
  it("coexistencia: solo version v5, sin sessionInfoVersion ni featureType", () => {
    assert.deepEqual(buildSignupExtras(true), { version: "v5" });
  });

  it("sin coexistencia apaga el onboarding de la app WhatsApp Business", () => {
    assert.deepEqual(buildSignupExtras(false), {
      version: "v5",
      features: [{ name: "whatsapp_business_app_onboarding", enabled: false }],
    });
  });
});

describe("signupBodySchema", () => {
  const standard = { mode: "standard", code: "AQB123", phoneNumberId: "1110001", wabaId: "2220002", pin: "123456" };
  const coexistence = { mode: "coexistence", code: "AQB123", wabaId: "2220002" };

  it("acepta un cuerpo estándar válido", () => {
    assert.equal(signupBodySchema.safeParse(standard).success, true);
  });

  it("rechaza PIN inválido, ids no numéricos, código vacío y campos extra en estándar", () => {
    assert.equal(signupBodySchema.safeParse({ ...standard, pin: "12345" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...standard, phoneNumberId: "x1" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...standard, code: "" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...standard, extra: 1 }).success, false);
  });

  it("estándar exige PIN y phoneNumberId", () => {
    const { pin: _pin, ...sinPin } = standard;
    const { phoneNumberId: _phone, ...sinPhone } = standard;
    assert.equal(signupBodySchema.safeParse(sinPin).success, false);
    assert.equal(signupBodySchema.safeParse(sinPhone).success, false);
  });

  it("coexistencia no pide PIN y el phoneNumberId es opcional", () => {
    assert.equal(signupBodySchema.safeParse(coexistence).success, true);
    assert.equal(signupBodySchema.safeParse({ ...coexistence, phoneNumberId: "1110001" }).success, true);
  });

  it("coexistencia rechaza PIN, ids inválidos y campos extra", () => {
    assert.equal(signupBodySchema.safeParse({ ...coexistence, pin: "123456" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...coexistence, wabaId: "abc" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...coexistence, phoneNumberId: "abc" }).success, false);
    assert.equal(signupBodySchema.safeParse({ ...coexistence, code: "   " }).success, false);
  });

  it("rechaza un modo faltante o desconocido", () => {
    const { mode: _mode, ...sinModo } = standard;
    assert.equal(signupBodySchema.safeParse(sinModo).success, false);
    assert.equal(signupBodySchema.safeParse({ ...standard, mode: "otro" }).success, false);
  });
});
