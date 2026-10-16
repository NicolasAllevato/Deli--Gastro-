import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mp = await import("../src/lib/payments/mercadopago.ts");

const SECRET = "secreto-de-prueba";
const NOW = 1_800_000_000;

function signed(overrides: Partial<{ dataId: string; requestId: string; ts: string; secret: string }> = {}) {
  const o = { dataId: "123456", requestId: "req-1", ts: String(NOW), secret: SECRET, ...overrides };
  const v1 = mp.signManifest(o.secret, mp.buildManifest(o));
  return { header: `ts=${o.ts},v1=${v1}`, requestId: o.requestId, dataId: o.dataId };
}

const verify = (s: ReturnType<typeof signed>, extra: Record<string, unknown> = {}) =>
  mp.verifyWebhookSignature({ signatureHeader: s.header, requestId: s.requestId, dataId: s.dataId, secret: SECRET, nowSeconds: NOW, ...extra });

describe("verifyWebhookSignature", () => {
  it("acepta un aviso firmado con el secreto y fresco", () => {
    assert.deepEqual(verify(signed()), { ok: true });
  });

  it("rechaza una firma hecha con otro secreto", () => {
    assert.deepEqual(verify(signed({ secret: "otro" })), { ok: false, reason: "mismatch" });
  });

  it("rechaza si cambió el id del pago, el request-id o el timestamp firmados", () => {
    const s = signed();
    assert.equal(verify({ ...s, dataId: "999" }).ok, false);
    assert.equal(verify({ ...s, requestId: "otro" }).ok, false);
    assert.equal(verify({ ...s, header: s.header.replace(`ts=${NOW}`, `ts=${NOW + 1}`) }).ok, false);
  });

  it("rechaza un aviso viejo aunque la firma sea válida (replay)", () => {
    const old = signed({ ts: String(NOW - 301) });
    assert.deepEqual(verify(old), { ok: false, reason: "stale" });
    assert.deepEqual(verify(signed({ ts: String(NOW - 300) })), { ok: true });
  });

  it("acepta timestamps en milisegundos", () => {
    assert.deepEqual(verify(signed({ ts: String(NOW * 1000) })), { ok: true });
  });

  it("rechaza encabezados incompletos o vacíos", () => {
    const s = signed();
    assert.deepEqual(verify({ ...s, header: "" }), { ok: false, reason: "missing" });
    assert.deepEqual(verify({ ...s, header: "ts=1" }), { ok: false, reason: "missing" });
    assert.deepEqual(verify({ ...s, requestId: "" }), { ok: false, reason: "missing" });
    assert.deepEqual(mp.verifyWebhookSignature({ signatureHeader: s.header, requestId: s.requestId, dataId: s.dataId, secret: "", nowSeconds: NOW }), { ok: false, reason: "missing" });
  });

  it("no revienta con firmas de largo distinto", () => {
    const s = signed();
    assert.deepEqual(verify({ ...s, header: `ts=${NOW},v1=abc` }), { ok: false, reason: "mismatch" });
  });

  it("pasa a minúsculas el id alfanumérico antes de firmar", () => {
    assert.equal(mp.buildManifest({ dataId: "ABC123", requestId: "r", ts: "1" }), "id:abc123;request-id:r;ts:1;");
    assert.equal(mp.buildManifest({ dataId: "123", requestId: "r", ts: "1" }), "id:123;request-id:r;ts:1;");
  });
});

describe("classifyPaymentStatus", () => {
  it("reduce los estados de Mercado Pago a cuatro", () => {
    assert.equal(mp.classifyPaymentStatus("approved"), "approved");
    for (const s of ["pending", "in_process", "in_mediation", "authorized", "algo-nuevo", null]) {
      assert.equal(mp.classifyPaymentStatus(s as string), "pending");
    }
    for (const s of ["rejected", "cancelled"]) assert.equal(mp.classifyPaymentStatus(s), "rejected");
    for (const s of ["refunded", "charged_back"]) assert.equal(mp.classifyPaymentStatus(s), "reversed");
  });
});

describe("paymentMatchesIntent", () => {
  const intent = { id: "intent-1", total: 9100 };
  const payment = { external_reference: "intent-1", currency_id: "ARS", transaction_amount: 9100 };

  it("acepta el pago que coincide en referencia, moneda y monto", () => {
    assert.equal(mp.paymentMatchesIntent(payment, intent), true);
  });

  it("rechaza otro monto, otra moneda u otra referencia", () => {
    assert.equal(mp.paymentMatchesIntent({ ...payment, transaction_amount: 100 }, intent), false);
    assert.equal(mp.paymentMatchesIntent({ ...payment, currency_id: "USD" }, intent), false);
    assert.equal(mp.paymentMatchesIntent({ ...payment, external_reference: "otra" }, intent), false);
    assert.equal(mp.paymentMatchesIntent({ ...payment, external_reference: null }, intent), false);
  });
});

describe("buildPreference", () => {
  const pref = mp.buildPreference({
    intentId: "intent-1",
    title: "Pedido Opsyn Dely",
    total: 15900,
    baseUrl: "https://dely.example.com/",
    notificationUrl: "https://dely.example.com/api/payments/mercadopago/webhook",
    expiresAt: new Date("2026-10-15T20:00:00Z"),
  });

  it("cobra una línea por el total, en pesos, con la intención como referencia", () => {
    assert.equal(pref.items.length, 1);
    assert.deepEqual([pref.items[0]!.unit_price, pref.items[0]!.quantity, pref.items[0]!.currency_id], [15900, 1, "ARS"]);
    assert.equal(pref.external_reference, "intent-1");
  });

  it("vuelve a la pantalla de pago de la intención y vence", () => {
    assert.equal(pref.back_urls.success, "https://dely.example.com/cliente/pago/intent-1");
    assert.equal(pref.expires, true);
    assert.equal(pref.expiration_date_to, "2026-10-15T20:00:00.000Z");
    assert.equal(pref.notification_url, "https://dely.example.com/api/payments/mercadopago/webhook");
  });
});

describe("isTestToken", () => {
  it("distingue credenciales de prueba", () => {
    assert.equal(mp.isTestToken("TEST-123"), true);
    assert.equal(mp.isTestToken("APP_USR-123"), false);
  });
});
