import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig } from "./helpers/demo-db.ts";

const { applyPointsDelta, awardPointsForOrder, enrichOrders, getClientByUserId, listOrders, numberConfig, readConfig } =
  await import("../src/lib/orders-server.ts");

describe("numberConfig / readConfig", () => {
  it("usa el valor numérico o el respaldo si falta o no es número", () => {
    assert.equal(numberConfig({ a: "12" }, "a", 1), 12);
    assert.equal(numberConfig({}, "a", 7), 7);
    assert.equal(numberConfig({ a: "abc" }, "a", 7), 7);
    assert.equal(numberConfig({ a: undefined }, "a", 7), 7);
  });

  it("lee la configuración como un objeto clave → valor", async () => {
    const { db } = createDemoDb();
    const config = await readConfig(db);
    assert.equal(config.cancelacion_min, 15);
    assert.equal(config.puntos_por_100, 0.5);
  });
});

describe("applyPointsDelta (puntos de fidelidad)", () => {
  it("suma al saldo, registra el movimiento y recalcula el nivel", async () => {
    const { db, store } = createDemoDb();
    const client = store.clients.find((c) => c.name === "María López")!; // 60 pts, Bronce
    const total = await applyPointsDelta(db, String(client.id), 100, "Pedido de prueba", null);
    assert.equal(total, 160);
    assert.equal(client.total_points, 160);
    assert.equal(client.tier, "Plata");
    const movimiento = store.points_ledger.at(-1)!;
    assert.deepEqual(
      [movimiento.client_id, movimiento.delta, movimiento.description],
      [client.id, 100, "Pedido de prueba"],
    );
  });

  it("un canje descuenta puntos y puede bajar de nivel", async () => {
    const { db, store } = createDemoDb();
    const client = store.clients.find((c) => c.name === "Juan Pérez")!; // 340 pts, Oro
    const total = await applyPointsDelta(db, String(client.id), -200, "Canje: Postre gratis", null);
    assert.equal(total, 140);
    assert.equal(client.tier, "Bronce");
  });

  it("el saldo nunca queda negativo", async () => {
    const { db, store } = createDemoDb();
    const client = store.clients.find((c) => c.name === "Lucas Fernández")!; // 35 pts
    const total = await applyPointsDelta(db, String(client.id), -500, "Canje", null);
    assert.equal(total, 0);
    assert.equal(client.total_points, 0);
  });

  it("devuelve 0 y no escribe nada si el cliente no existe", async () => {
    const { db, store } = createDemoDb();
    const before = store.points_ledger.length;
    assert.equal(await applyPointsDelta(db, crypto.randomUUID(), 10, "x", null), 0);
    assert.equal(store.points_ledger.length, before);
  });

  it("usa los niveles configurados en niveles_lealtad", async () => {
    const { db, store } = createDemoDb((s) =>
      setConfig(s, "niveles_lealtad", [
        { nombre: "Bronce", desde: 0 },
        { nombre: "Oro", desde: 70 },
      ]),
    );
    const client = store.clients.find((c) => c.name === "María López")!; // 60 pts
    await applyPointsDelta(db, String(client.id), 10, "x", null);
    assert.equal(client.tier, "Oro");
  });
});

describe("awardPointsForOrder", () => {
  it("acredita los puntos del pedido según puntos_por_100 y es idempotente", async () => {
    const { db, store } = createDemoDb();
    const client = store.clients.find((c) => c.name === "María López")!;
    const order = { id: crypto.randomUUID(), client_id: String(client.id), total: 9100, items_desc: "1x Hamburguesa" };

    const first = await awardPointsForOrder(db, order);
    assert.equal(first, 45); // floor(9100 / 100 * 0.5)
    assert.equal(client.total_points, 105);

    assert.equal(await awardPointsForOrder(db, order), 0);
    assert.equal(client.total_points, 105);
  });

  it("acredita los puntos aunque el pedido ya tenga un canje descontado", async () => {
    const { db, store } = createDemoDb();
    const client = store.clients.find((c) => c.name === "María López")!; // 60 pts
    const order = { id: crypto.randomUUID(), client_id: String(client.id), total: 9100, items_desc: "1x Hamburguesa" };
    await applyPointsDelta(db, String(client.id), -20, "Canje: algo", order.id);
    assert.equal(client.total_points, 40);

    assert.equal(await awardPointsForOrder(db, order), 45);
    assert.equal(client.total_points, 85);
    assert.equal(await awardPointsForOrder(db, order), 0);
  });

  it("no acredita nada en pedidos de mostrador o con puntos_por_100 en cero", async () => {
    const { db, store } = createDemoDb((s) => setConfig(s, "puntos_por_100", 0));
    const client = store.clients[0]!;
    const before = client.total_points;
    assert.equal(
      await awardPointsForOrder(db, { id: crypto.randomUUID(), client_id: null, total: 5000, items_desc: "x" }),
      0,
    );
    assert.equal(
      await awardPointsForOrder(db, { id: crypto.randomUUID(), client_id: String(client.id), total: 5000, items_desc: "x" }),
      0,
    );
    assert.equal(client.total_points, before);
  });
});

describe("consultas de pedidos y clientes", () => {
  it("enrichOrders resuelve el nombre del cliente y usa 'Mostrador' sin cliente", async () => {
    const { db, store } = createDemoDb();
    const withClient = store.orders.find((o) => o.client_id)!;
    const [a, b] = await enrichOrders(db, [
      withClient as never,
      { id: "x", client_id: null, status: "Recibidos", items_desc: "1x A", total: 100, created_at: "2026-01-01T00:00:00Z" },
    ]);
    assert.notEqual(a!.client_name, "Mostrador");
    assert.equal(b!.client_name, "Mostrador");
    assert.equal(b!.channel, "web");
    assert.equal(b!.delivery_fee, 0);
    assert.equal(b!.updated_at, "2026-01-01T00:00:00Z");
  });

  it("listOrders filtra por estado, excluye cancelados y respeta el límite", async () => {
    const { db } = createDemoDb();
    const recibidos = await listOrders(db, { statuses: ["Recibidos"] });
    assert.ok(recibidos.length > 0);
    assert.ok(recibidos.every((o) => o.status === "Recibidos"));

    const sinCancelados = await listOrders(db, { excludeCancelled: true, limit: 500 });
    assert.ok(sinCancelados.every((o) => o.status !== "Cancelado"));

    assert.equal((await listOrders(db, { limit: 3 })).length, 3);
  });

  it("getClientByUserId encuentra al cliente de la cuenta demo", async () => {
    const { db } = createDemoDb();
    const client = await getClientByUserId(db, "00000000-0000-4000-8000-0000000000c1");
    assert.equal(client?.name, "Sofía Martínez");
    assert.equal(await getClientByUserId(db, "no-existe"), null);
  });
});
