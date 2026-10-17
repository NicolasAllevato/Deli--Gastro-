import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { buildTools } = await import("../src/lib/agent/tools.ts");

// Modo demo = pasarela simulada: el link apunta al simulador local y no se sale a la red.
const previousDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
const previousToken = process.env.MP_ACCESS_TOKEN;

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_MODE = "true";
});
afterEach(() => {
  if (previousDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
  else process.env.NEXT_PUBLIC_DEMO_MODE = previousDemo;
  if (previousToken === undefined) delete process.env.MP_ACCESS_TOKEN;
  else process.env.MP_ACCESS_TOKEN = previousToken;
});

function newDemo(): DemoDb {
  return createDemoDb((s) => {
    setConfig(s, "horario_apertura", "00:00");
    setConfig(s, "horario_cierre", "23:59");
    s.wa_conversations.push({
      id: crypto.randomUUID(),
      client_phone: "5491155550101",
      contact_name: "Sofía",
      client_id: null,
      state: {},
      human_takeover: false,
      last_inbound_at: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  });
}

function tools(demo: DemoDb, messageId: string) {
  const conversation = demo.store.wa_conversations[0] as never;
  const list = buildTools({ db: demo.db, conversation, messageId, dryRun: false });
  const byName = (name: string) => list.find((t) => t.name === name)!;
  return {
    call: async (name: string, args: unknown) => {
      const tool = byName(name);
      return (await tool.run(tool.validate(args))) as Record<string, unknown>;
    },
  };
}

async function quote(demo: DemoDb) {
  const burger = String(demo.store.products.find((p) => p.name === "Hamburguesa Clásica")!.id);
  const out = await tools(demo, "m1").call("quote_order", { items: [{ product_id: burger, qty: 1 }], address: "Av. Corrientes 1234" });
  assert.equal(out.error, undefined, String(out.error));
  return out;
}

describe("asistente de WhatsApp · pago con Mercado Pago", () => {
  it("confirm_order devuelve el link de pago y NO crea el pedido todavía", async () => {
    const demo = newDemo();
    await quote(demo);
    const before = demo.store.orders.length;

    const out = await tools(demo, "m2").call("confirm_order", { payment_method: "Mercado Pago" });
    assert.equal(out.ok, true);
    assert.equal(out.awaiting_payment, true);
    assert.match(String(out.payment_url), /^\/demo\/mercadopago\//);
    assert.equal(out.total, 9100);
    assert.equal(demo.store.orders.length, before);
    assert.equal(demo.store.payment_intents.length, 1);
    assert.equal(demo.store.payment_intents[0]!.channel, "whatsapp");
  });

  it("order_status informa el pago pendiente con su link, y cancel_order lo cancela sin cobrar", async () => {
    const demo = newDemo();
    await quote(demo);
    await tools(demo, "m2").call("confirm_order", { payment_method: "Mercado Pago" });

    const status = await tools(demo, "m3").call("order_status", {});
    assert.deepEqual([status.found, status.awaiting_payment, status.total], [true, true, 9100]);
    assert.match(String(status.payment_url), /^\/demo\/mercadopago\//);

    const cancelled = await tools(demo, "m4").call("cancel_order", {});
    assert.equal(cancelled.ok, true);
    assert.equal(demo.store.payment_intents[0]!.status, "cancelled");
    assert.equal((await tools(demo, "m5").call("order_status", {})).awaiting_payment, undefined);
  });

  it("sin cobro digital configurado, Mercado Pago no se ofrece y confirm_order lo rechaza sin perder el borrador", async () => {
    const demo = newDemo();
    await quote(demo);
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    delete process.env.MP_ACCESS_TOKEN;

    const info = await tools(demo, "m2").call("get_business_info", {});
    assert.deepEqual(info.payment_methods, ["Efectivo", "Tarjeta"]);

    const out = await tools(demo, "m2").call("confirm_order", { payment_method: "Mercado Pago" });
    assert.match(String(out.error), /no está habilitado/);
    assert.equal(demo.store.payment_intents.length, 0);
    const conversation = demo.store.wa_conversations[0]!;
    assert.ok((conversation.state as { draft?: unknown }).draft, "el borrador debe quedar para reintentar con otra forma de pago");
  });

  it("efectivo y tarjeta siguen creando el pedido al instante", async () => {
    const demo = newDemo();
    await quote(demo);
    const before = demo.store.orders.length;
    const out = await tools(demo, "m2").call("confirm_order", { payment_method: "Efectivo" });
    assert.equal(out.ok, true);
    assert.equal(out.awaiting_payment, undefined);
    assert.equal(demo.store.orders.length, before + 1);
    assert.equal(demo.store.payment_intents.length, 0);
  });
});
