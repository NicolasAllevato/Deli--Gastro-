import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/demo-db.ts";

const { suggestPaymentIds, findUnknownPaymentIds, decideSave, parseFudoCatalog } = await import("../src/lib/fudo/mapping.ts");
const { demoFudoPaymentMethodsPayload } = await import("../src/lib/demo/fudo-fixture.ts");
const { deliveredPoint } = await import("../src/lib/delivery-metrics.ts");
const { planSalesImport, parseFudoSales } = await import("../workers/fudo-gateway/src/sales.ts");

const catalog = parseFudoCatalog(demoFudoPaymentMethodsPayload());

describe("medios de pago de Fudo", () => {
  it("sugiere el id activo y no el duplicado dado de baja", () => {
    assert.deepEqual(suggestPaymentIds(catalog), { Efectivo: 1, Tarjeta: 6, "Mercado Pago": 14 });
  });
  it("no sugiere un medio inactivo", () => {
    assert.deepEqual(suggestPaymentIds([{ id: 5, name: "Mercadopago", active: false }]), {});
  });
  it("rechaza un id que Fudo no tiene y deja pasar si no hay lista", () => {
    const payments = [{ paymentMethod: "Efectivo" as const, fudoPaymentMethodId: 99 }];
    assert.deepEqual(findUnknownPaymentIds(payments, catalog), [99]);
    assert.equal(decideSave([], [], payments, catalog).ok, false);
    assert.equal(decideSave([], [], payments, []).ok, true);
  });
});

describe("punto de entrega en el mapa", () => {
  const none = { delivered_lat: null, delivered_lng: null, delivery_lat: null, delivery_lng: null };
  it("prefiere el punto real, si no usa la dirección y sin datos no marca", () => {
    assert.deepEqual(deliveredPoint({ delivered_lat: 1, delivered_lng: 2, delivery_lat: 3, delivery_lng: 4 }), { lat: 1, lng: 2 });
    assert.deepEqual(deliveredPoint({ ...none, delivery_lat: 3, delivery_lng: 4 }), { lat: 3, lng: 4 });
    assert.equal(deliveredPoint(none), null);
  });
});

describe("dirección de ventas de delivery de clientes registrados", () => {
  const sale = (anonymousCustomer: unknown) =>
    parseFudoSales({ data: [{
      type: "Sale", id: "500",
      attributes: { createdAt: "2026-11-04T00:13:30Z", closedAt: null, total: 100, saleType: "DELIVERY", saleState: "IN-COURSE", anonymousCustomer },
      relationships: { customer: { data: { type: "Customer", id: "7" } }, items: { data: [] }, payments: { data: [] } },
    }] });
  const plan = (sales: ReturnType<typeof parseFudoSales>) =>
    planSalesImport({
      sales, itemsBySale: new Map(), productsByFudoId: new Map(), existing: [],
      clientsByFudoId: new Map([[7, "cliente-1"]]), clientsByPhone: new Map(),
      clientAddressById: new Map([["cliente-1", "Calle Real 123"]]),
    }).inserts[0].delivery_address;

  it("usa la dirección del cliente cuando la venta no trae una", () => {
    assert.equal(plan(sale(null)), "Calle Real 123");
    assert.equal(plan(sale({ name: "x", address: '["-"]' })), "Calle Real 123");
  });
  it("la dirección de la venta tiene prioridad", () => {
    assert.equal(plan(sale({ name: "x", address: '["Otra","9"]' })), "Otra 9");
  });
});

describe("detalle de pagos por medio", async () => {
  const { parsePaymentRows, salePaymentLines } = await import("../workers/fudo-gateway/src/sales.ts");
  const { paymentShares, salesSummary } = await import("../src/lib/reports/analytics.ts");
  const { buildPaymentUsage } = await import("../src/lib/fudo/mapping.ts");

  const pay = (id: string, method: string, amount: number, canceled = false) => ({
    type: "Payment", id, attributes: { amount, canceled }, relationships: { paymentMethod: { data: { type: "PaymentMethod", id: method } } },
  });
  const usageRow = (over: Record<string, unknown>) => ({ id: "x", created_at: "2026-11-01T12:00:00Z", status: "Finalizados", total: 100, fudo_payment: null, fudo_payments: null, ...over });

  it("suma repetidos y descarta anulados", () => {
    const rows = parsePaymentRows([pay("1", "1", 300), pay("2", "1", 200), pay("3", "14", 700), pay("4", "6", 999, true)]);
    const names = new Map([[1, "Efectivo"], [14, "Mercado pago"], [6, "Payway"]]);
    assert.deepEqual(salePaymentLines([1, 2, 3, 4], rows, names), [{ name: "Efectivo", amount: 500 }, { name: "Mercado pago", amount: 700 }]);
  });

  it("reparte un pago mixto por su monto y unifica Mercado Pago", () => {
    const shares = paymentShares({ total: 1000, payment_method: null, fudo_payments: [{ name: "Efectivo", amount: 400 }, { name: "Mercado pago", amount: 600 }] });
    assert.deepEqual(shares, [{ name: "Efectivo", amount: 400 }, { name: "Mercado Pago", amount: 600 }]);
  });

  it("sin detalle no inventa el reparto", () => {
    assert.deepEqual(paymentShares({ total: 1000, payment_method: null, fudo_payment: "Efectivo + Payway" }), [{ name: "Efectivo + Payway", amount: 1000 }]);
  });

  it("el informe por medio conserva el total", () => {
    const base = { id: "a", client_id: null, status: "Finalizados", delivery_fee: 0, channel: "fudo", items_desc: "", created_at: "2026-11-01T12:00:00Z", accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null };
    const orders = [
      { ...base, total: 1000, payment_method: null, fudo_payments: [{ name: "Efectivo", amount: 400 }, { name: "Payway", amount: 600 }] },
      { ...base, id: "b", total: 500, payment_method: "Efectivo" },
    ];
    const bounds = { from: new Date("2026-10-01T00:00:00Z").getTime(), to: new Date("2026-12-01T00:00:00Z").getTime() };
    const groups = salesSummary(orders, bounds as never, "payment").groups;
    assert.deepEqual(groups, [{ key: "Efectivo", orders: 2, revenue: 900 }, { key: "Payway", orders: 1, revenue: 600 }]);
  });

  it("lista todos los medios aunque no tengan ventas y no suma cancelados", () => {
    const usage = buildPaymentUsage([
      usageRow({ fudo_payments: [{ name: "Mercado pago", amount: 100 }] }),
      usageRow({ status: "Cancelado", fudo_payments: [{ name: "Payway", amount: 900 }] }),
    ], catalog);
    assert.equal(usage.length, catalog.length);
    const mp = usage.find((u) => u.name === "Mercado pago");
    assert.equal(mp?.id, 14);
    assert.equal(mp?.amount, 100);
    assert.equal(usage.find((u) => u.name === "Payway")?.orders, 0);
    assert.equal(usage.find((u) => u.name === "Mercadopago")?.orders, 0);
  });
});

describe("detalle de pagos de una venta abierta", async () => {
  const { planSalesImport, parseFudoSales } = await import("../workers/fudo-gateway/src/sales.ts");
  const sales = parseFudoSales({ data: [{ type: "Sale", id: "500", attributes: { createdAt: "2026-11-04T00:13:30Z", closedAt: null, total: 100, saleType: "TAKEAWAY", saleState: "IN-COURSE" }, relationships: { items: { data: [] }, payments: { data: [] } } }] });
  const base = { sales, itemsBySale: new Map(), productsByFudoId: new Map(), clientsByFudoId: new Map(), clientsByPhone: new Map() };
  it("se inserta sin detalle y se completa cuando llega el cobro", () => {
    const inserted = planSalesImport({ ...base, existing: [], paymentLinesBySale: new Map([[500, []]]) });
    assert.equal(inserted.inserts[0].fudo_payments, null);
    const existing = [{ id: "o1", fudo_order_id: 500, channel: "fudo", status: "Recibidos", fudo_sale_state: "IN-COURSE", client_id: "c", fudo_source: "local", fudo_payments: null }];
    assert.equal(planSalesImport({ ...base, existing, paymentLinesBySale: new Map([[500, []]]) }).paymentFills.length, 0);
    const lines = [{ name: "Efectivo", amount: 100 }];
    assert.deepEqual(planSalesImport({ ...base, existing, paymentLinesBySale: new Map([[500, lines]]) }).paymentFills, [{ id: "o1", fudo_payments: lines }]);
  });
});
