import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../src/lib/whatsapp/diagnose.ts";

const okClient = {
  getPhoneInfo: async () => ({ display_phone_number: "+54 9 11 1234-5678", verified_name: "Deli", quality_rating: "GREEN" }),
  getWabaInfo: async () => ({ id: "WABA", name: "Deli Gastro" }),
  isAppSubscribed: async () => true,
};

describe("diagnose", () => {
  it("con todo bien queda listo", async () => {
    const d = await diagnose(okClient, true);
    assert.equal(d.ready, true);
    assert.match(d.phone.detail, /Deli · \+54 9 11 1234-5678 · calidad GREEN/);
    assert.equal(d.waba.detail, "Deli Gastro");
  });

  it("sin WABA ID marca la cuenta y la suscripción como pendientes", async () => {
    const d = await diagnose(okClient, false);
    assert.equal(d.phone.status, "ok");
    assert.equal(d.waba.status, "pending");
    assert.equal(d.subscription.status, "pending");
    assert.equal(d.ready, false);
  });

  it("detecta la app sin suscribir aunque el número y la cuenta estén bien", async () => {
    const d = await diagnose({ ...okClient, isAppSubscribed: async () => false }, true);
    assert.equal(d.subscription.status, "pending");
    assert.match(d.subscription.detail, /no está suscrita/);
    assert.equal(d.ready, false);
  });

  it("informa el error de Meta de cada paso por separado", async () => {
    const d = await diagnose(
      {
        ...okClient,
        getPhoneInfo: async () => { throw new Error("Token inválido"); },
        getWabaInfo: async () => { throw new Error("WABA inexistente"); },
      },
      true,
    );
    assert.deepEqual([d.phone.status, d.phone.detail], ["error", "Token inválido"]);
    assert.deepEqual([d.waba.status, d.waba.detail], ["error", "WABA inexistente"]);
    assert.equal(d.subscription.status, "pending");
  });
});
