/**
 * Autorización de la capa de datos D1: reproduce las políticas RLS actuales
 * (G1–G18 del auditor). Corre contra el esquema real en node:sqlite.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as clients from "../src/lib/data/clients.ts";
import * as orders from "../src/lib/data/orders.ts";
import * as points from "../src/lib/data/points.ts";
import * as reviews from "../src/lib/data/reviews.ts";
import * as catalog from "../src/lib/data/catalog.ts";
import * as payments from "../src/lib/data/payments.ts";
import * as couriers from "../src/lib/data/couriers.ts";
import * as pins from "../src/lib/data/pin-attempts.ts";
import { STAFF_ONLY_TABLES, listStaffTable } from "../src/lib/data/restricted.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});
const forbidden = (p: Promise<unknown>) => assert.rejects(p, ForbiddenError);

describe("G1 clients: lectura", () => {
  it("el cliente lee su fila", async () => {
    assert.equal((await clients.getClient(db, actors.ana, "c-ana"))?.name, "Ana");
  });
  it("el cliente NO lee la de otro", async () => {
    assert.equal(await clients.getClient(db, actors.ana, "c-beto"), null);
  });
  it("anon y repartidor no leen clientes; listar es solo staff", async () => {
    await forbidden(clients.getClient(db, actors.anon, "c-ana"));
    await forbidden(clients.getClient(db, actors.rep1, "c-ana"));
    await forbidden(clients.listClients(db, actors.ana));
    assert.equal((await clients.listClients(db, actors.admin)).length, 2);
  });
});

describe("G2 clients: alta", () => {
  it("el user_id sale de la sesión", async () => {
    db.raw.prepare(`INSERT INTO "user" (id, email, createdAt, updatedAt) VALUES ('u-new','n@x.test','x','x')`).run();
    await clients.createOwnClient(db, { kind: "cliente", userId: "u-new" }, { id: "c-new", name: "Nuevo" });
    const row = db.raw.prepare("SELECT user_id FROM clients WHERE id='c-new'").get() as { user_id: string };
    assert.equal(row.user_id, "u-new");
  });
  it("un cliente no puede crear una segunda fila (user_id UNIQUE)", async () => {
    await assert.rejects(clients.createOwnClient(db, actors.ana, { id: "c-dup", name: "X" }));
  });
  it("anon/repartidor no crean clientes", async () => {
    await forbidden(clients.createOwnClient(db, actors.anon, { id: "c-x", name: "X" }));
    await forbidden(clients.createOwnClient(db, actors.rep1, { id: "c-x", name: "X" }));
  });
});

describe("G3 clients: edición con columnas protegidas", () => {
  it("edita su nombre", async () => {
    assert.equal(await clients.updateClient(db, actors.ana, "c-ana", { name: "Ana M" }), true);
  });
  it("PATCH con total_points=999999 se rechaza y no cambia nada", async () => {
    await forbidden(clients.updateClient(db, actors.ana, "c-ana", { total_points: 999999 }));
    const row = db.raw.prepare("SELECT total_points FROM clients WHERE id='c-ana'").get() as { total_points: number };
    assert.equal(row.total_points, 100);
  });
  for (const field of ["tier", "user_id", "wa_marketing_opt_in", "unsubscribed_at", "id"]) {
    it(`el cliente no puede cambiar ${field}`, async () => {
      await forbidden(clients.updateClient(db, actors.ana, "c-ana", { [field]: "x" }));
    });
  }
  it("no puede editar la fila de otro", async () => {
    assert.equal(await clients.updateClient(db, actors.ana, "c-beto", { name: "hack" }), false);
    const row = db.raw.prepare("SELECT name FROM clients WHERE id='c-beto'").get() as { name: string };
    assert.equal(row.name, "Beto");
  });
  it("ni el admin puede tocar total_points directo (solo por ledger)", async () => {
    await forbidden(clients.updateClient(db, actors.admin, "c-ana", { total_points: 5 }));
  });
  it("nombres de columna inyectados se rechazan", async () => {
    await forbidden(clients.updateClient(db, actors.ana, "c-ana", { "name = 'x', tier": "Oro" }));
  });
});

describe("G4 orders: lectura y escritura", () => {
  it("el cliente ve solo sus pedidos", async () => {
    const ids = (await orders.listOrders(db, actors.ana)).map((o) => o.id).sort();
    assert.deepEqual(ids, ["o-ana-1", "o-ana-2"]);
    assert.equal(await orders.getOrder(db, actors.ana, "o-beto-1"), null);
  });
  it("anon no ve pedidos", async () => {
    await forbidden(orders.listOrders(db, actors.anon));
  });
  it("el cliente no cambia estados ni asigna", async () => {
    await forbidden(orders.setOrderStatus(db, actors.ana, "o-ana-2", "Finalizados"));
    await forbidden(orders.assignOrder(db, actors.ana, "o-ana-2", null, null));
    await forbidden(orders.claimOrder(db, actors.ana, "o-libre", "Ana"));
  });
  it("admin ve todo y cambia estados", async () => {
    assert.equal((await orders.listOrders(db, actors.admin)).length, 4);
    assert.equal(await orders.setOrderStatus(db, actors.admin, "o-libre", "Cancelado"), true);
  });
});

describe("G5 order_items", () => {
  it("items solo de pedidos propios", async () => {
    assert.equal((await orders.listOrderItems(db, actors.ana, "o-ana-1")).length, 1);
    assert.equal((await orders.listOrderItems(db, actors.ana, "o-beto-1")).length, 0);
  });
});

describe("G6 points_ledger y doble gasto", () => {
  it("el cliente lee solo su ledger", async () => {
    const rows = await points.listLedger(db, actors.ana);
    assert.deepEqual(rows.map((r) => r.client_id), ["c-ana"]);
    await forbidden(points.listLedger(db, actors.ana, "c-beto"));
  });
  it("el cliente no escribe en el ledger", async () => {
    await forbidden(points.addPoints(db, actors.ana, { id: "l-x", clientId: "c-ana", delta: 1000, description: "x" }));
  });
  it("el total se deriva del ledger", async () => {
    await points.addPoints(db, actors.system, { id: "l-2", clientId: "c-ana", delta: 25, description: "pedido" });
    const r = db.raw.prepare("SELECT total_points FROM clients WHERE id='c-ana'").get() as { total_points: number };
    assert.equal(r.total_points, 125);
  });
  it("dos canjes concurrentes de 80 sobre 100: uno solo pasa, saldo nunca negativo", async () => {
    const results = await Promise.allSettled([
      points.addPoints(db, actors.system, { id: "l-c1", clientId: "c-ana", delta: -80, description: "canje" }),
      points.addPoints(db, actors.system, { id: "l-c2", clientId: "c-ana", delta: -80, description: "canje" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof points.InsufficientPointsError);
    const r = db.raw.prepare("SELECT total_points FROM clients WHERE id='c-ana'").get() as { total_points: number };
    assert.equal(r.total_points, 20);
    const n = db.raw.prepare("SELECT count(*) n FROM points_ledger WHERE client_id='c-ana'").get() as { n: number };
    assert.equal(n.n, 2);
  });
  it("un canje fallido dentro de un batch revierte todo el batch", async () => {
    await assert.rejects(
      db.batch([
        db.prepare("INSERT INTO points_ledger (id, client_id, delta, description) VALUES (?, ?, ?, ?)").bind("b1", "c-ana", -50, "x"),
        db.prepare("INSERT INTO points_ledger (id, client_id, delta, description) VALUES (?, ?, ?, ?)").bind("b2", "c-ana", -60, "x"),
      ]),
    );
    const r = db.raw.prepare("SELECT total_points FROM clients WHERE id='c-ana'").get() as { total_points: number };
    assert.equal(r.total_points, 100);
  });
});

describe("G7 reviews", () => {
  it("el cliente lee solo las suyas", async () => {
    assert.equal((await reviews.listReviews(db, actors.ana)).length, 0);
    assert.equal((await reviews.listReviews(db, actors.beto)).length, 1);
  });
  it("solo reseña su pedido Finalizado, una vez", async () => {
    assert.equal(await reviews.createOwnReview(db, actors.ana, { id: "r1", orderId: "o-ana-1", rating: 5 }), true);
    assert.equal(await reviews.createOwnReview(db, actors.ana, { id: "r2", orderId: "o-ana-1", rating: 1 }), false);
    assert.equal(await reviews.createOwnReview(db, actors.ana, { id: "r3", orderId: "o-ana-2", rating: 5 }), false, "no entregado");
    assert.equal(await reviews.createOwnReview(db, actors.ana, { id: "r4", orderId: "o-beto-1", rating: 1 }), false, "ajeno");
  });
});

describe("G8/G9/G10 config, catálogo y reportes", () => {
  it("config: lectura pública, escritura staff", async () => {
    assert.deepEqual(await catalog.getConfig(db, actors.anon, "store"), { open: true });
    await forbidden(catalog.setConfig(db, actors.ana, "store", { open: false }));
    await catalog.setConfig(db, actors.admin, "store", { open: false });
    assert.deepEqual(await catalog.getConfig(db, actors.anon, "store"), { open: false });
  });
  it("catálogo: anon ve solo activos; escribir es admin", async () => {
    assert.deepEqual((await catalog.listProducts(db, actors.anon)).map((p) => p.id), ["p-on"]);
    assert.equal((await catalog.listProducts(db, actors.admin)).length, 2);
    for (const a of [actors.anon, actors.ana, actors.rep1]) {
      await forbidden(catalog.upsertProduct(db, a, { id: "p-x", categoryId: null, name: "x", priceCents: 1 }));
      await forbidden(catalog.upsertCategory(db, a, { id: "c-x", name: "x" }));
    }
    await catalog.upsertProduct(db, actors.admin, { id: "p-x", categoryId: "cat-1", name: "x", priceCents: 100 });
  });
  it("precio en centavos enteros", async () => {
    await assert.rejects(catalog.upsertProduct(db, actors.admin, { id: "p-y", categoryId: null, name: "y", priceCents: 10.5 }));
  });
  it("reports_daily solo staff (observación del auditor)", async () => {
    await forbidden(catalog.listDailyReports(db, actors.ana, "2026-01-01", "2026-12-31"));
    await forbidden(catalog.listDailyReports(db, actors.rep1, "2026-01-01", "2026-12-31"));
    assert.deepEqual(await catalog.listDailyReports(db, actors.admin, "2026-01-01", "2026-12-31"), []);
  });
});

describe("G11/G12 tablas solo de servidor", () => {
  for (const table of STAFF_ONLY_TABLES) {
    it(`${table}: cliente, repartidor y anon no leen`, async () => {
      for (const a of [actors.anon, actors.ana, actors.rep1]) await forbidden(listStaffTable(db, a, table));
      await listStaffTable(db, actors.admin, table);
    });
  }
  it("integration_secrets no existe en D1", () => {
    const t = db.raw.prepare("SELECT name FROM sqlite_master WHERE name='integration_secrets'").get();
    assert.equal(t, undefined);
  });
  it("una tabla fuera de la lista blanca se rechaza", async () => {
    await assert.rejects(listStaffTable(db, actors.admin, "user" as never));
  });
  it("payment_intents: el cliente ve solo las suyas", async () => {
    assert.equal((await payments.getPaymentIntent(db, actors.ana, "pi-ana"))?.id, "pi-ana");
    assert.equal(await payments.getPaymentIntent(db, actors.beto, "pi-ana"), null);
    await forbidden(payments.getPaymentIntent(db, actors.rep1, "pi-ana"));
  });
  it("listado de repartidores sin pin_hash ni pin_encrypted", async () => {
    const [c] = await couriers.listCouriers(db, actors.admin);
    assert.deepEqual(Object.keys(c).sort(), ["active", "name", "user_id"]);
    await forbidden(couriers.listCouriers(db, actors.rep1));
  });
});

describe("G13 repartidor: pedidos, ubicación y turno propios", () => {
  it("ve los suyos y los libres, no los de otro repartidor", async () => {
    const ids = (await orders.listOrders(db, actors.rep1)).map((o) => o.id).sort();
    assert.deepEqual(ids, ["o-ana-2", "o-libre"]);
    assert.equal(await orders.getOrder(db, actors.rep1, "o-beto-1"), null);
  });
  it("no entrega un pedido de otro", async () => {
    assert.equal(await orders.setOrderStatus(db, actors.rep1, "o-beto-1", "Finalizados"), false);
    assert.equal(await orders.setOrderStatus(db, actors.rep1, "o-ana-2", "Finalizados"), true);
  });
  it("solo puede marcar Finalizados", async () => {
    await forbidden(orders.setOrderStatus(db, actors.rep1, "o-ana-2", "Cancelado"));
  });
  it("toma de pedido libre: dos a la vez, gana uno", async () => {
    const [a, b] = await Promise.all([
      orders.claimOrder(db, actors.rep1, "o-libre", "Rep Uno"),
      orders.claimOrder(db, actors.rep2, "o-libre", "Rep Dos"),
    ]);
    assert.equal(Number(a) + Number(b), 1);
    assert.equal(await orders.claimOrder(db, actors.rep2, "o-ana-2", "Rep Dos"), false, "no roba pedidos asignados");
  });
  it("ubicación: siempre la propia (sin courierId en la firma)", async () => {
    await couriers.upsertOwnLocation(db, actors.rep2, { courierName: "Rep Dos", lat: -34.6, lng: -58.4 });
    const rows = db.raw.prepare("SELECT user_id FROM courier_locations").all() as { user_id: string }[];
    assert.deepEqual(rows.map((r) => r.user_id), ["u-rep2"]);
    await forbidden(couriers.upsertOwnLocation(db, actors.ana, { courierName: "x", lat: 0, lng: 0 }));
    await forbidden(couriers.listLocations(db, actors.rep1));
  });
  it("turno: pide el propio; decidir es admin", async () => {
    await couriers.requestOwnShift(db, actors.rep1, { id: "s1", courierName: "Rep Uno", shiftDay: "2026-11-12" });
    assert.equal(((await couriers.getOwnShift(db, actors.rep2, "2026-11-12")) ?? null), null);
    await forbidden(couriers.decideShift(db, actors.rep1, "s1", "approved"));
    assert.equal(await couriers.decideShift(db, actors.admin, "s1", "approved"), true);
  });
});

describe("G14 PIN: rate limit y bloqueo", () => {
  it("bloquea tras 5 fallos y libera al pasar el bloqueo", async () => {
    const t0 = new Date("2026-11-12T12:00:00Z");
    for (let i = 0; i < pins.PIN_MAX_FAILURES - 1; i++) assert.equal(await pins.recordPinFailure(db, actors.system, "ip:1", t0), false);
    assert.equal(await pins.recordPinFailure(db, actors.system, "ip:1", t0), true);
    assert.equal(await pins.isPinLocked(db, actors.system, "ip:1", t0), true);
    assert.equal(await pins.isPinLocked(db, actors.system, "ip:2", t0), false, "otra clave no se ve afectada");
    const later = new Date(t0.getTime() + pins.PIN_LOCK_MS + 1000);
    assert.equal(await pins.isPinLocked(db, actors.system, "ip:1", later), false);
  });
  it("la ventana se reinicia", async () => {
    const t0 = new Date("2026-11-12T12:00:00Z");
    for (let i = 0; i < pins.PIN_MAX_FAILURES - 1; i++) await pins.recordPinFailure(db, actors.system, "ip:3", t0);
    const later = new Date(t0.getTime() + pins.PIN_WINDOW_MS + 1000);
    assert.equal(await pins.recordPinFailure(db, actors.system, "ip:3", later), false);
  });
  it("solo el servidor maneja intentos y búsqueda por hash", async () => {
    await forbidden(pins.recordPinFailure(db, actors.rep1, "ip:1"));
    await forbidden(couriers.findCourierByPinHash(db, actors.ana, "hash-1"));
    assert.equal((await couriers.findCourierByPinHash(db, actors.system, "hash-1"))?.user_id, "u-rep1");
  });
});

describe("G15 payment_intents: aprobación idempotente", () => {
  it("webhook repetido = un solo efecto", async () => {
    const effect = () => [
      db.prepare(
        "INSERT INTO order_events (id, order_id, event) SELECT ?, 'o-ana-1', 'paid' WHERE EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'approved')",
      ).bind(crypto.randomUUID(), "pi-ana"),
    ];
    const first = await payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 }, effect);
    const again = await payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 }, () => []);
    assert.equal(first, true);
    assert.equal(again, false);
    const n = db.raw.prepare("SELECT count(*) n FROM order_events WHERE event='paid'").get() as { n: number };
    assert.equal(n.n, 1);
  });
  it("dos webhooks concurrentes: uno solo aprueba", async () => {
    const r = await Promise.all([
      payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 }),
      payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 }),
    ]);
    assert.equal(r.filter(Boolean).length, 1);
  });
  it("si un efecto falla, la aprobación se revierte", async () => {
    await assert.rejects(
      payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-2", expectedVersion: 0 }, () => [
        db.prepare("INSERT INTO order_events (id, order_id, event) VALUES (?, ?, ?)").bind("e1", "no-existe", "paid"),
      ]),
    );
    const row = db.raw.prepare("SELECT status FROM payment_intents WHERE id='pi-ana'").get() as { status: string };
    assert.equal(row.status, "pending");
  });
  it("no se puede cancelar algo aprobado; clientes no aprueban", async () => {
    await payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 });
    assert.equal(await payments.closePaymentIntent(db, actors.system, "pi-ana", "cancelled"), false);
    await forbidden(payments.approvePaymentIntent(db, actors.ana, { id: "pi-ana", mpPaymentId: "x", expectedVersion: 1 }));
  });
});

describe("G15 HIGH del auditor: webhook repetido en serie no duplica pedido ni puntos", () => {
  // Misma fábrica de efectos que usaría el webhook real: crea pedido, item y puntos.
  const effects = (d: typeof db) => () => [
    d.prepare(
      "INSERT INTO orders (id, client_id, items_desc, total_cents, payment_intent_id) VALUES (?, 'c-ana', 'Pizza', 1250050, ?) ON CONFLICT (payment_intent_id) DO NOTHING",
    ).bind(crypto.randomUUID(), "pi-ana"),
    d.prepare(
      "INSERT INTO order_items (id, order_id, name, qty, unit_price_cents) SELECT ?, o.id, 'Pizza', 1, 1250050 FROM orders o WHERE o.payment_intent_id = ? AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)",
    ).bind(crypto.randomUUID(), "pi-ana"),
    points.addPointsStatement(d, actors.system, {
      id: crypto.randomUUID(), clientId: "c-ana", delta: 12, description: "pedido pagado", idempotencyKey: "earn:pi-ana",
    }),
  ];
  it("dos llamadas seguidas: 1 pedido, 1 item, 1 asiento", async () => {
    const a = await payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 }, effects(db));
    const b = await payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 0 }, effects(db));
    const c = await payments.approvePaymentIntent(db, actors.system, { id: "pi-ana", mpPaymentId: "mp-1", expectedVersion: 1 }, effects(db));
    assert.deepEqual([a, b, c], [true, false, false]);
    const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
    assert.equal(count("SELECT count(*) n FROM orders WHERE payment_intent_id = 'pi-ana'"), 1);
    assert.equal(count("SELECT count(*) n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.payment_intent_id = 'pi-ana'"), 1);
    assert.equal(count("SELECT count(*) n FROM points_ledger WHERE idempotency_key = 'earn:pi-ana'"), 1);
    assert.equal(count("SELECT total_points n FROM clients WHERE id = 'c-ana'"), 112);
  });
  it("en efectos de pago la idempotencyKey es obligatoria", () => {
    assert.throws(() =>
      points.addPointsStatement(db, actors.system, { id: "z", clientId: "c-ana", delta: 1, description: "x", idempotencyKey: " " }),
    );
  });
  it("ON CONFLICT matchea los índices únicos del esquema + migraciones", async () => {
    const idx = db.raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name LIKE '%full_uidx'").all() as { sql: string }[];
    assert.equal(idx.length, 2);
    assert.ok(idx.every((i) => !/WHERE/i.test(i.sql)), "índices completos, no parciales");
  });
  it("addPoints con la misma clave no suma dos veces", async () => {
    const e = { clientId: "c-beto", delta: 5, description: "x", idempotencyKey: "k1" };
    assert.equal(await points.addPoints(db, actors.system, { id: "a1", ...e }), true);
    assert.equal(await points.addPoints(db, actors.system, { id: "a2", ...e }), false);
    assert.equal((db.raw.prepare("SELECT total_points n FROM clients WHERE id='c-beto'").get() as { n: number }).n, 55);
  });
});

describe("Condiciones del auditor", () => {
  it("el repartidor no ve la dirección de un pedido libre hasta tomarlo", async () => {
    db.raw.prepare("UPDATE orders SET delivery_address = 'Calle 123' WHERE id IN ('o-libre','o-ana-2')").run();
    const libre = await orders.getOrder(db, actors.rep1, "o-libre");
    assert.equal(libre?.delivery_address, null);
    assert.equal((await orders.getOrder(db, actors.rep1, "o-ana-2"))?.delivery_address, "Calle 123");
    const listed = await orders.listOrders(db, actors.rep1);
    assert.equal(listed.find((o) => o.id === "o-libre")?.delivery_address, null);
    await orders.claimOrder(db, actors.rep1, "o-libre", "Rep Uno");
    assert.equal((await orders.getOrder(db, actors.rep1, "o-libre"))?.delivery_address, "Calle 123");
  });
  it("tope global de fallos de PIN aunque se roten IPs", async () => {
    const t0 = new Date("2026-11-12T12:00:00Z");
    for (let i = 0; i < pins.PIN_GLOBAL_MAX; i++) await pins.recordPinFailure(db, actors.system, `ip:rot-${i}`, t0);
    assert.equal(await pins.isPinLocked(db, actors.system, "ip:nueva", t0), true);
    await assert.rejects(pins.recordPinFailure(db, actors.system, pins.PIN_GLOBAL_KEY, t0));
  });
});

describe("G18 rol solo del servidor", () => {
  it("el CHECK del esquema solo admite los 3 roles", () => {
    assert.throws(() =>
      db.raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES ('z','z@x','superadmin','x','x')`).run(),
    );
  });
});
