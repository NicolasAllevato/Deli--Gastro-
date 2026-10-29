import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { cancelOrder, confirmOrder, customerInfo, orderStatus, quoteOrder } = await import("../src/lib/agent/order-actions.ts");
const { DRAFT_TTL_MS } = await import("../src/lib/agent/draft.ts");
import type { OrderActionDeps } from "../src/lib/agent/order-actions.ts";

// Fija el comportamiento actual de las acciones de pedido con dependencias inyectadas:
// base en memoria, geocodificador falso, reloj fijo y pasarela falsa (sin red ni env).
const T0 = new Date("2026-10-20T15:00:00.000Z");
const NEAR = { label: "Av. Corrientes 1234, CABA", lat: -34.6037, lng: -58.3816 };
const FAR = { label: "Lejos 1, Rosario", lat: -33, lng: -60.6 };

const fakeGateway = {
  createCheckout: async () => ({ id: "pref-1", url: "https://pago.test/abc" }),
} as never;

function newDemo(mutate?: (s: DemoDb["store"]) => void): DemoDb {
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
      updated_at: T0.toISOString(),
      created_at: T0.toISOString(),
    });
    mutate?.(s);
  });
}

function depsFor(
  demo: DemoDb,
  messageId: string,
  extra: Partial<OrderActionDeps> = {},
): OrderActionDeps {
  return {
    db: demo.db,
    conversation: demo.store.wa_conversations[0] as never,
    messageId,
    dryRun: false,
    now: () => T0,
    geocode: async () => [NEAR],
    gateway: () => fakeGateway,
    ...extra,
  };
}

const productId = (demo: DemoDb, name: string) => String(demo.store.products.find((p) => p.name === name)!.id);
const draftOf = (demo: DemoDb) => (demo.store.wa_conversations[0]!.state as { draft?: Record<string, unknown> }).draft;

async function quoted(demo: DemoDb, messageId = "m1") {
  const out = await quoteOrder(depsFor(demo, messageId), {
    items: [{ product_id: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
    address: "Av. Corrientes 1234",
  });
  assert.equal("error" in out, false, JSON.stringify(out));
  return out;
}

describe("quoteOrder", () => {
  it("cotiza un pedido válido y guarda el borrador en el estado de la conversación", async () => {
    const demo = newDemo();
    const out = await quoted(demo);
    assert.deepEqual(out, {
      lines: [{ name: "Hamburguesa Clásica", qty: 1, price: 8500 }],
      subtotal: 8500,
      delivery_fee: 600,
      total: 9100,
      zone: (out as { zone: unknown }).zone,
      resolved_address: NEAR.label,
      note: "Mostrale el resumen y preguntale si confirma. No crees el pedido hasta su respuesta.",
    });
    const draft = draftOf(demo)!;
    assert.equal(draft.quotedByMessageId, "m1");
    assert.equal(draft.quotedAt, T0.toISOString());
    assert.equal(draft.fee, 600);
    assert.equal(draft.subtotal, 8500);
    assert.deepEqual(draft.items, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }]);
  });

  it("rechaza un producto inactivo y no guarda borrador", async () => {
    const demo = newDemo();
    const out = await quoteOrder(depsFor(demo, "m1"), {
      items: [{ product_id: productId(demo, "Cheesecake de Frutos Rojos"), qty: 1 }],
      address: "Av. Corrientes 1234",
    });
    assert.equal(typeof (out as { error?: unknown }).error, "string");
    assert.equal(draftOf(demo), undefined);
  });

  it("rechaza un producto inexistente", async () => {
    const demo = newDemo();
    const out = await quoteOrder(depsFor(demo, "m1"), {
      items: [{ product_id: crypto.randomUUID(), qty: 1 }],
      address: "Av. Corrientes 1234",
    });
    assert.equal(typeof (out as { error?: unknown }).error, "string");
    assert.equal(draftOf(demo), undefined);
  });

  it("dirección fuera de zona: error y sin borrador", async () => {
    const demo = newDemo();
    const out = await quoteOrder(depsFor(demo, "m1", { geocode: async () => [FAR] }), {
      items: [{ product_id: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
      address: "Lejos 1, Rosario",
    });
    assert.equal(typeof (out as { error?: unknown }).error, "string");
    assert.equal(draftOf(demo), undefined);
  });

  it("pedido por debajo del mínimo de la zona: error y sin borrador", async () => {
    const demo = newDemo();
    // Z3 (demo) exige $8000 de mínimo.
    const z3 = { label: "Z3 1, CABA", lat: -34.605, lng: -58.265 };
    const out = await quoteOrder(depsFor(demo, "m1", { geocode: async () => [z3] }), {
      items: [{ product_id: productId(demo, "Limonada con Menta"), qty: 1 }],
      address: "Z3 1, CABA",
    });
    assert.equal(typeof (out as { error?: unknown }).error, "string");
    assert.equal(draftOf(demo), undefined);
  });

  it("dirección no encontrada", async () => {
    const demo = newDemo();
    const out = await quoteOrder(depsFor(demo, "m1", { geocode: async () => [] }), {
      items: [{ product_id: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
      address: "Calle inexistente 99999",
    });
    assert.deepEqual(out, { error: "No encontré esa dirección. Pedile calle, altura y barrio." });
  });

  it("si el geocodificador falla se trata como dirección no encontrada", async () => {
    const demo = newDemo();
    const out = await quoteOrder(
      depsFor(demo, "m1", { geocode: async () => { throw new Error("red caída"); } }),
      { items: [{ product_id: productId(demo, "Hamburguesa Clásica"), qty: 1 }], address: "Av. Corrientes 1234" },
    );
    assert.deepEqual(out, { error: "No encontré esa dirección. Pedile calle, altura y barrio." });
  });

  it("local en pausa o cerrado: no cotiza", async () => {
    const paused = newDemo((s) => setConfig(s, "modo_pausa", true));
    const input = { items: [{ product_id: "x", qty: 1 }], address: "Av. Corrientes 1234" };
    assert.deepEqual(await quoteOrder(depsFor(paused, "m1"), input), { error: "El local pausó los pedidos por ahora.", code: "closed" });

    const closed = newDemo((s) => {
      setConfig(s, "horario_apertura", "10:00");
      setConfig(s, "horario_cierre", "11:00");
    });
    // 15:00 UTC = 12:00 en Buenos Aires: fuera de 10:00–11:00.
    assert.deepEqual(await quoteOrder(depsFor(closed, "m1"), input), { error: "El local está cerrado. Abre de 10:00 a 11:00.", code: "closed" });
  });
});

describe("confirmOrder", () => {
  it("sin cotización previa no crea nada", async () => {
    const demo = newDemo();
    const before = demo.store.orders.length;
    const out = await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo" });
    assert.deepEqual(out, { error: "No hay un pedido cotizado. Usá quote_order primero.", code: "no_draft" });
    assert.equal(demo.store.orders.length, before);
  });

  it("en el mismo mensaje que cotizó no confirma", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    const out = await confirmOrder(depsFor(demo, "m1"), { payment_method: "Efectivo" });
    assert.deepEqual(out, { error: "El cliente todavía no confirmó. Mostrale el resumen con el total y esperá su respuesta.", code: "not_confirmed" });
    assert.ok(draftOf(demo), "el borrador se conserva");
  });

  it("borrador vencido: pide recotizar", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    const later = new Date(T0.getTime() + DRAFT_TTL_MS + 1000);
    const out = await confirmOrder(depsFor(demo, "m2", { now: () => later }), { payment_method: "Efectivo" });
    assert.deepEqual(out, { error: "La cotización venció. Volvé a cotizar el pedido con quote_order.", code: "expired" });
  });

  it("total cambiado desde la cotización: conflicto, no se crea el pedido y el borrador vuelve", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    // El precio sube después de cotizar: el total esperado (9100) ya no coincide.
    demo.store.products.find((p) => p.name === "Hamburguesa Clásica")!.price = 9000;
    const before = demo.store.orders.length;
    const out = await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo" });
    assert.equal(typeof (out as { error?: unknown }).error, "string");
    assert.equal(demo.store.orders.length, before);
    assert.ok(draftOf(demo), "el borrador se devuelve para reintentar o recotizar");
  });

  it("efectivo crea el pedido al instante y consume el borrador", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    const before = demo.store.orders.length;
    const out = await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo", notes: "sin cebolla" });
    assert.equal((out as { ok?: boolean }).ok, true);
    assert.match(String((out as { order_code?: string }).order_code), /^#[0-9A-F]{8}$/);
    assert.equal((out as { total?: number }).total, 9100);
    assert.equal((out as { payment_method?: string }).payment_method, "Efectivo");
    assert.equal(demo.store.orders.length, before + 1);
    assert.equal(demo.store.payment_intents.length, 0);
    assert.equal(draftOf(demo), undefined);
  });

  it("Mercado Pago abre el pago y NO crea el pedido", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    const before = demo.store.orders.length;
    const out = await confirmOrder(depsFor(demo, "m2"), { payment_method: "Mercado Pago" });
    assert.equal((out as { awaiting_payment?: boolean }).awaiting_payment, true);
    assert.equal((out as { payment_url?: string }).payment_url, "https://pago.test/abc");
    assert.equal((out as { total?: number }).total, 9100);
    assert.equal(demo.store.orders.length, before);
    assert.equal(demo.store.payment_intents.length, 1);
  });

  it("Mercado Pago sin pasarela: error y el borrador queda para reintentar", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    const out = await confirmOrder(depsFor(demo, "m2", { gateway: () => null }), { payment_method: "Mercado Pago" });
    assert.deepEqual(out, { error: "El pago con Mercado Pago todavía no está habilitado. Ofrecé efectivo o tarjeta." });
    assert.equal(demo.store.payment_intents.length, 0);
    assert.ok(draftOf(demo));
  });

  it("dry run: valida pero no crea ni reclama el borrador", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    const before = demo.store.orders.length;
    const out = await confirmOrder(depsFor(demo, "m2", { dryRun: true }), { payment_method: "Efectivo" });
    assert.deepEqual(out, { ok: true, dry_run: true, note: "Prueba: el pedido no se creó." });
    assert.equal(demo.store.orders.length, before);
    assert.ok(draftOf(demo));
  });

  it("local cerrado: no confirma", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    setConfig(demo.store, "modo_pausa", true);
    const out = await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo" });
    assert.deepEqual(out, { error: "El local pausó los pedidos por ahora.", code: "closed" });
  });
});

describe("orderStatus / cancelOrder", () => {
  it("sin pedidos: found false y nada para cancelar", async () => {
    const demo = newDemo();
    assert.deepEqual(await orderStatus(depsFor(demo, "m1")), { found: false });
    assert.deepEqual(await cancelOrder(depsFor(demo, "m1")), { error: "No encontré un pedido para cancelar." });
  });

  it("con un pedido en Recibidos informa el estado y lo cancela", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo" });
    const status = await orderStatus(depsFor(demo, "m3"));
    assert.equal((status as { found?: boolean }).found, true);
    assert.equal((status as { status?: string }).status, "Recibidos");
    assert.equal((status as { total?: number }).total, 9100);

    const dry = await cancelOrder(depsFor(demo, "m4", { dryRun: true }));
    assert.deepEqual(dry, { ok: true, dry_run: true, note: "Prueba: el pedido no se canceló." });
    assert.equal(demo.store.orders.at(-1)!.status !== "Cancelado", true);

    assert.deepEqual(await cancelOrder(depsFor(demo, "m5")), { ok: true });
    assert.equal(demo.store.orders.find((o) => o.client_id === demo.store.wa_conversations[0]!.client_id && o.status === "Cancelado") !== undefined, true);
  });

  it("fuera de Recibidos no se puede cancelar", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo" });
    const mine = demo.store.orders.filter((o) => o.client_id === demo.store.wa_conversations[0]!.client_id);
    mine.at(-1)!.status = "Preparando";
    const out = await cancelOrder(depsFor(demo, "m3"));
    assert.deepEqual(out, { error: "El pedido ya está en preparación y no se puede cancelar." });
  });

  it("pago pendiente de Mercado Pago: orderStatus lo informa y cancelOrder lo cancela", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    await confirmOrder(depsFor(demo, "m2"), { payment_method: "Mercado Pago" });

    const status = await orderStatus(depsFor(demo, "m3"));
    assert.deepEqual([(status as { awaiting_payment?: boolean }).awaiting_payment, (status as { total?: number }).total], [true, 9100]);

    const dry = await cancelOrder(depsFor(demo, "m4", { dryRun: true }));
    assert.deepEqual(dry, { ok: true, dry_run: true, note: "Prueba: el pago no se canceló." });
    assert.equal(demo.store.payment_intents[0]!.status, "pending");

    const out = await cancelOrder(depsFor(demo, "m5"));
    assert.deepEqual(out, { ok: true, note: "Se canceló el pago pendiente. No se cobró nada." });
    assert.equal(demo.store.payment_intents[0]!.status, "cancelled");
    assert.equal((await orderStatus(depsFor(demo, "m6")) as { awaiting_payment?: boolean }).awaiting_payment, undefined);
  });
});

describe("customerInfo", () => {
  it("cliente desconocido: devuelve solo el nombre de contacto", async () => {
    const demo = newDemo();
    assert.deepEqual(await customerInfo(depsFor(demo, "m1")), { known: false, name: "Sofía" });
  });

  it("cliente conocido tras su primer pedido: nombre, dirección guardada y recientes", async () => {
    const demo = newDemo();
    await quoted(demo, "m1");
    await confirmOrder(depsFor(demo, "m2"), { payment_method: "Efectivo" });
    const info = await customerInfo(depsFor(demo, "m3"));
    assert.equal((info as { known?: boolean }).known, true);
    assert.equal((info as { recent_orders: unknown[] }).recent_orders.length, 1);
  });
});
