import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { priceOrder, createDeliveryOrder, cancelOrderForClient } = await import("../src/lib/orders-create.ts");
const { SAMPLE_ADDRESSES } = await import("../src/lib/restaurant.ts");

const CASA = SAMPLE_ADDRESSES[0]!; // Av. Corrientes: dentro de la "Zona cercana" ($600, sin mínimo)
const LEJOS = { address: "Ushuaia", lat: -54.8, lng: -68.3 };

function productId(demo: DemoDb, name: string): string {
  const row = demo.store.products.find((p) => p.name === name);
  assert.ok(row, `el seed no trae el producto ${name}`);
  return String(row.id);
}

function clientId(demo: DemoDb): string {
  return String(demo.store.clients[0]!.id);
}

/** Solo una zona con pedido mínimo, para aislar la lógica del mínimo. */
function withSingleZone(demo: DemoDb, minOrder: number): void {
  const zone = demo.store.delivery_zones[0]!;
  demo.store.delivery_zones.length = 0;
  demo.store.delivery_zones.push({ ...zone, min_order: minOrder, fee: 700 });
}

describe("priceOrder", () => {
  it("recalcula subtotal, envío y zona contra los precios de la base", async () => {
    const demo = createDemoDb();
    const result = await priceOrder(demo.db, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 2 }], CASA);
    assert.ok(result.ok);
    assert.equal(result.value.subtotal, 17000);
    assert.equal(result.value.fee, 600);
    assert.equal(result.value.zone, "Zona cercana");
    assert.deepEqual(result.value.lines.map((l) => [l.name, l.qty, l.price]), [["Hamburguesa Clásica", 2, 8500]]);
  });

  it("junta las líneas repetidas del mismo producto", async () => {
    const demo = createDemoDb();
    const id = productId(demo, "Limonada con Menta");
    const result = await priceOrder(demo.db, [{ productId: id, qty: 1 }, { productId: id, qty: 3 }], CASA);
    assert.ok(result.ok);
    assert.equal(result.value.lines.length, 1);
    assert.equal(result.value.lines[0]!.qty, 4);
    assert.equal(result.value.subtotal, 4 * 2600);
  });

  it("rechaza el pedido si el local está en pausa o cerrado", async () => {
    for (const [key, value] of [["modo_pausa", true], ["tienda_activa", false]] as const) {
      const demo = createDemoDb((s) => setConfig(s, key, value));
      const result = await priceOrder(demo.db, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], CASA);
      assert.ok(!result.ok);
      assert.equal(result.status, 409);
    }
  });

  it("rechaza una dirección fuera de cobertura", async () => {
    const demo = createDemoDb();
    const result = await priceOrder(demo.db, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], LEJOS);
    assert.ok(!result.ok);
    assert.equal(result.status, 400);
    assert.match(result.message, /fuera de las zonas/);
  });

  it("rechaza productos inactivos o inexistentes", async () => {
    const demo = createDemoDb();
    const inactivo = await priceOrder(demo.db, [{ productId: productId(demo, "Cheesecake de Frutos Rojos"), qty: 1 }], CASA);
    assert.ok(!inactivo.ok);
    assert.equal(inactivo.status, 400);

    const fantasma = await priceOrder(demo.db, [{ productId: crypto.randomUUID(), qty: 1 }], CASA);
    assert.ok(!fantasma.ok);
    assert.match(fantasma.message, /ya no está disponible/);
  });

  it("exige el pedido mínimo de la zona", async () => {
    const demo = createDemoDb((s) => withSingleZone({ store: s } as DemoDb, 8000));
    const barato = await priceOrder(demo.db, [{ productId: productId(demo, "Limonada con Menta"), qty: 1 }], CASA);
    assert.ok(!barato.ok);
    assert.match(barato.message, /pedido mínimo/i);

    const alcanza = await priceOrder(demo.db, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], CASA);
    assert.ok(alcanza.ok);
    assert.equal(alcanza.value.minOrder, 8000);
  });
});

describe("createDeliveryOrder", () => {
  it("crea el pedido con total, envío, canal y bitácora", async () => {
    const demo = createDemoDb();
    const before = demo.store.orders.length;
    const result = await createDeliveryOrder(demo.db, {
      clientId: clientId(demo),
      items: [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
      address: CASA,
      paymentMethod: "Efectivo",
      notes: "Sin cebolla",
      channel: "web",
      actor: "cliente",
      expectedTotal: 8500 + 600,
    });
    assert.ok(result.ok);
    assert.equal(result.value.status, "Recibidos");
    assert.equal(result.value.total, 9100);
    assert.equal(result.value.delivery_fee, 600);
    assert.equal(result.value.items_desc, "1x Hamburguesa Clásica");
    assert.equal(demo.store.orders.length, before + 1);

    const event = demo.store.order_events.find((e) => e.order_id === result.value.id);
    assert.equal(event?.event, "Recibidos");
    assert.equal(event?.actor, "cliente");
  });

  it("no crea nada si el precio cambió desde la cotización", async () => {
    const demo = createDemoDb();
    const before = demo.store.orders.length;
    const result = await createDeliveryOrder(demo.db, {
      clientId: clientId(demo),
      items: [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
      address: CASA,
      paymentMethod: "Tarjeta",
      channel: "whatsapp",
      actor: "agente",
      expectedTotal: 1,
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 409);
    assert.equal(demo.store.orders.length, before);
  });
});

describe("createDeliveryOrder con canje de puntos", () => {
  // Sofía (cliente 0) tiene 180 puntos: alcanza el 10 % (100) y la bebida (150), no el postre (200).
  const base = (demo: DemoDb, items: Array<{ productId: string; qty: number }>, rewardId?: string, expectedTotal?: number) => ({
    clientId: clientId(demo),
    items,
    address: CASA,
    paymentMethod: "Efectivo" as const,
    channel: "web" as const,
    actor: "cliente",
    rewardId,
    expectedTotal,
  });
  const saldo = (demo: DemoDb) => Number(demo.store.clients[0]!.total_points);

  it("aplica el descuento al total, deja la nota y descuenta los puntos ligados al pedido", async () => {
    const demo = createDemoDb();
    const burger = productId(demo, "Hamburguesa Clásica");
    const result = await createDeliveryOrder(demo.db, base(demo, [{ productId: burger, qty: 2 }], "descuento", 17000 - 1700 + 600));
    assert.ok(result.ok);
    assert.equal(result.value.total, 15900);
    assert.equal(result.value.delivery_fee, 600);
    assert.match(String(result.value.notes), /10% de descuento/);

    assert.equal(saldo(demo), 80);
    const mov = demo.store.points_ledger.at(-1)!;
    assert.deepEqual([mov.order_id, mov.delta, mov.description], [result.value.id, -100, "Canje: 10% de descuento"]);
  });

  it("conserva las aclaraciones del cliente junto a la nota del canje", async () => {
    const demo = createDemoDb();
    const result = await createDeliveryOrder(demo.db, {
      ...base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], "descuento"),
      notes: "Sin cebolla",
    });
    assert.ok(result.ok);
    assert.match(String(result.value.notes), /Sin cebolla/);
    assert.match(String(result.value.notes), /Canje de puntos/);
  });

  it("la bebida gratis descuenta la bebida con su tope", async () => {
    const demo = createDemoDb();
    const result = await createDeliveryOrder(
      demo.db,
      base(demo, [{ productId: productId(demo, "Limonada con Menta"), qty: 1 }], "bebida"),
    );
    assert.ok(result.ok);
    assert.equal(result.value.total, 2600 - 2000 + 600);
    assert.equal(saldo(demo), 30);
  });

  it("rechaza el canje si el pedido no tiene el producto y no toca los puntos", async () => {
    const demo = createDemoDb();
    const before = demo.store.orders.length;
    const result = await createDeliveryOrder(
      demo.db,
      base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], "bebida"),
    );
    assert.ok(!result.ok);
    assert.equal(result.status, 400);
    assert.match(result.message, /bebidas/);
    assert.equal(demo.store.orders.length, before);
    assert.equal(saldo(demo), 180);
  });

  it("rechaza el canje sin puntos suficientes", async () => {
    const demo = createDemoDb();
    const result = await createDeliveryOrder(
      demo.db,
      base(demo, [{ productId: productId(demo, "Volcán de Cacao"), qty: 1 }], "postre"),
    );
    assert.ok(!result.ok);
    assert.equal(result.status, 409);
    assert.match(result.message, /puntos/);
    assert.equal(saldo(demo), 180);
  });

  it("rechaza una recompensa inexistente", async () => {
    const demo = createDemoDb();
    const result = await createDeliveryOrder(
      demo.db,
      base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], "no-existe"),
    );
    assert.ok(!result.ok);
    assert.equal(result.status, 400);
  });

  it("el total esperado incluye el descuento: si no coincide, no crea ni cobra puntos", async () => {
    const demo = createDemoDb();
    const before = demo.store.orders.length;
    const result = await createDeliveryOrder(
      demo.db,
      base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], "descuento", 8500 + 600),
    );
    assert.ok(!result.ok);
    assert.equal(result.status, 409);
    assert.equal(demo.store.orders.length, before);
    assert.equal(saldo(demo), 180);
  });

  it("un pedido sin canje no cambia: mismo total y mismos puntos", async () => {
    const demo = createDemoDb();
    const result = await createDeliveryOrder(demo.db, base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }]));
    assert.ok(result.ok);
    assert.equal(result.value.total, 9100);
    assert.equal(saldo(demo), 180);
  });

  it("cancelar el pedido devuelve los puntos una sola vez", async () => {
    const demo = createDemoDb();
    const created = await createDeliveryOrder(demo.db, base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], "descuento"));
    assert.ok(created.ok);
    assert.equal(saldo(demo), 80);

    const cancelled = await cancelOrderForClient(demo.db, created.value.id, clientId(demo), "cliente");
    assert.ok(cancelled.ok);
    assert.equal(saldo(demo), 180);

    const devolucion = demo.store.points_ledger.at(-1)!;
    assert.deepEqual([devolucion.order_id, devolucion.delta], [created.value.id, 100]);
    assert.match(String(devolucion.description), /^Devolución/);

    // Una segunda cancelación (o un reintento del admin) no devuelve de nuevo.
    const { refundRedeemedPoints } = await import("../src/lib/orders-server.ts");
    assert.equal(await refundRedeemedPoints(demo.db, created.value.id), 0);
    assert.equal(saldo(demo), 180);
  });

  it("cancelar un pedido sin canje no mueve los puntos", async () => {
    const demo = createDemoDb();
    const created = await createDeliveryOrder(demo.db, base(demo, [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }]));
    assert.ok(created.ok);
    const before = demo.store.points_ledger.length;
    assert.ok((await cancelOrderForClient(demo.db, created.value.id, clientId(demo), "cliente")).ok);
    assert.equal(demo.store.points_ledger.length, before);
    assert.equal(saldo(demo), 180);
  });
});

describe("cancelOrderForClient", () => {
  async function newOrder(demo: DemoDb) {
    const created = await createDeliveryOrder(demo.db, {
      clientId: clientId(demo),
      items: [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
      address: CASA,
      paymentMethod: "Efectivo",
      channel: "web",
      actor: "cliente",
    });
    assert.ok(created.ok);
    return created.value;
  }

  it("cancela un pedido recibido dentro de la ventana y lo deja en la bitácora", async () => {
    const demo = createDemoDb();
    const order = await newOrder(demo);
    const result = await cancelOrderForClient(demo.db, order.id, clientId(demo), "cliente");
    assert.ok(result.ok);
    assert.equal(result.value.status, "Cancelado");
    assert.ok(demo.store.order_events.some((e) => e.order_id === order.id && e.event === "Cancelado"));
  });

  it("no deja cancelar dos veces ni pedidos en preparación o entregados", async () => {
    const demo = createDemoDb();
    const order = await newOrder(demo);
    const owner = clientId(demo);
    assert.ok((await cancelOrderForClient(demo.db, order.id, owner, "cliente")).ok);

    const again = await cancelOrderForClient(demo.db, order.id, owner, "cliente");
    assert.ok(!again.ok);
    assert.equal(again.status, 409);
    assert.match(again.message, /ya está cancelado/);

    const enPreparacion = demo.store.orders.find((o) => o.status === "En Preparación")!;
    const prep = await cancelOrderForClient(demo.db, String(enPreparacion.id), String(enPreparacion.client_id), "cliente");
    assert.ok(!prep.ok);
    assert.match(prep.message, /en preparación/);

    const entregado = demo.store.orders.find((o) => o.status === "Finalizados")!;
    const done = await cancelOrderForClient(demo.db, String(entregado.id), String(entregado.client_id), "cliente");
    assert.ok(!done.ok);
    assert.match(done.message, /ya fue entregado/);
  });

  it("respeta la ventana configurada", async () => {
    const demo = createDemoDb((s) => setConfig(s, "cancelacion_min", 15));
    const order = await newOrder(demo);
    const stored = demo.store.orders.find((o) => o.id === order.id)!;
    stored.created_at = new Date(Date.now() - 16 * 60_000).toISOString();

    const result = await cancelOrderForClient(demo.db, order.id, clientId(demo), "cliente");
    assert.ok(!result.ok);
    assert.equal(result.status, 409);
    assert.match(result.message, /15 minutos/);
    assert.equal(stored.status, "Recibidos");
  });

  it("no revela ni cancela pedidos de otro cliente", async () => {
    const demo = createDemoDb();
    const order = await newOrder(demo);
    const otro = String(demo.store.clients[1]!.id);
    const result = await cancelOrderForClient(demo.db, order.id, otro, "cliente");
    assert.ok(!result.ok);
    assert.equal(result.status, 404);
  });
});
