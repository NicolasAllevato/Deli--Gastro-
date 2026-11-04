import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseFudoSales, parseFudoItem, planSalesImport, phoneKey, parseFudoAddress, mapSaleState } = await import(
  "../workers/fudo-gateway/src/sales.ts"
);

const rawSale = (over: Record<string, unknown> = {}, rel: Record<string, unknown> = {}) => ({
  type: "Sale",
  id: "500",
  attributes: {
    createdAt: "2026-11-04T00:13:30Z",
    total: 24990,
    saleType: "DELIVERY",
    saleState: "IN-COURSE",
    comment: null,
    customerName: "Leo",
    anonymousCustomer: { name: "Leo", phone: "+54 9 11 6832-9555", address: '["Av. Siempre Viva","742","","CABA"]' },
    ...over,
  },
  relationships: { customer: { data: null }, items: { data: [{ id: "9001", type: "Item" }, { id: "9002", type: "Item" }] }, ...rel },
});

describe("helpers de ventas de Fudo", () => {
  it("phoneKey se queda con los últimos 10 dígitos (iguala +54 9 11… con 11…)", () => {
    assert.equal(phoneKey("+54 9 11 6832-9555"), "1168329555");
    assert.equal(phoneKey("011 15 6832 9555"), "1568329555".slice(-10));
    assert.equal(phoneKey("1168329555"), "1168329555");
    assert.equal(phoneKey(null), null);
    assert.equal(phoneKey("123"), null);
  });

  it("parseFudoAddress arma la dirección del array JSON e ignora guiones y vacíos", () => {
    assert.equal(parseFudoAddress('["Av. Siempre Viva","742","","CABA"]'), "Av. Siempre Viva 742, CABA");
    assert.equal(parseFudoAddress('["-"]'), null);
    assert.equal(parseFudoAddress("Calle 1"), "Calle 1");
    assert.equal(parseFudoAddress(null), null);
  });

  it("mapSaleState traduce los estados de Fudo a los del tablero", () => {
    assert.equal(mapSaleState("PENDING"), "Recibidos");
    assert.equal(mapSaleState("IN-COURSE"), "Recibidos");
    assert.equal(mapSaleState("PAYMENT-PROCESS"), "En Preparación");
    assert.equal(mapSaleState("READY-TO-DELIVER"), "En Preparación");
    assert.equal(mapSaleState("DELIVERY-SENT"), "En Camino");
    assert.equal(mapSaleState("CLOSED"), "Finalizados");
    assert.equal(mapSaleState("CANCELED"), "Cancelado");
  });
});

describe("parseFudoSales / parseFudoItem", () => {
  it("lee la venta JSON:API con cliente anónimo e ítems", () => {
    const [s] = parseFudoSales({ data: [rawSale()] });
    assert.equal(s.id, 500);
    assert.equal(s.saleType, "DELIVERY");
    assert.equal(s.total, 24990);
    assert.deepEqual(s.itemIds, [9001, 9002]);
    assert.equal(s.customerId, null);
    assert.equal(s.anon?.phone, "+54 9 11 6832-9555");
  });

  it("lee el cliente registrado de la relación", () => {
    const [s] = parseFudoSales({ data: [rawSale({}, { customer: { data: { id: "77", type: "Customer" } } })] });
    assert.equal(s.customerId, 77);
  });

  it("parseFudoItem lee producto, cantidad, precio y cancelación", () => {
    const item = parseFudoItem({ data: { id: "9001", attributes: { quantity: 2, price: 5000, canceled: null, comment: "sin sal" }, relationships: { product: { data: { id: "104" } } } } });
    assert.deepEqual(item, { id: 9001, productId: 104, quantity: 2, price: 5000, canceled: false, comment: "sin sal" });
    assert.equal(parseFudoItem({ data: { id: "x" } }), null);
  });
});

const base = () => ({
  sales: parseFudoSales({ data: [rawSale()] }),
  itemsBySale: new Map([[500, [
    { id: 9001, productId: 104, quantity: 2, price: 5000, canceled: false, comment: null },
    { id: 9002, productId: 999, quantity: 1, price: 14990, canceled: false, comment: null },
  ]]]),
  productsByFudoId: new Map([[104, { id: "p-margarita", name: "Pizza Margarita" }]]),
  existing: [] as Array<{ id: string; fudo_order_id: number; channel: string; status: string; fudo_sale_state: string | null }>,
  clientsByFudoId: new Map<number, string>(),
  clientsByPhone: new Map<string, string>(),
});

describe("planSalesImport", () => {
  it("crea un pedido del canal fudo con ítems, descripción, dirección y estado", () => {
    const plan = planSalesImport(base());
    assert.equal(plan.inserts.length, 1);
    const o = plan.inserts[0];
    assert.equal(o.channel, "fudo");
    assert.equal(o.fudo_order_id, 500);
    assert.equal(o.status, "Recibidos");
    assert.equal(o.total, 24990);
    assert.equal(o.fudo_sale_type, "DELIVERY");
    assert.equal(o.items_desc, "2x Pizza Margarita · 1x Producto Fudo #999");
    assert.equal(o.delivery_address, "Av. Siempre Viva 742, CABA");
    assert.equal(o.client_id, null);
    assert.deepEqual(o.lines, [
      { product_id: "p-margarita", name: "Pizza Margarita", qty: 2, unit_price: 5000 },
      { product_id: null, name: "Producto Fudo #999", qty: 1, unit_price: 14990 },
    ]);
  });

  it("ignora las ventas de salón (EAT-IN) y los ítems cancelados", () => {
    const input = base();
    input.sales = parseFudoSales({ data: [rawSale(), rawSale({ saleType: "EAT-IN" }, {})].map((s, i) => ({ ...s, id: String(500 + i) })) });
    input.itemsBySale.set(500, [{ id: 1, productId: 104, quantity: 1, price: 5000, canceled: true, comment: null }, { id: 2, productId: 104, quantity: 3, price: 5000, canceled: false, comment: null }]);
    const plan = planSalesImport(input);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].items_desc, "3x Pizza Margarita");
  });

  it("vincula al cliente por id de Fudo y, si es anónimo, por teléfono", () => {
    const byId = base();
    byId.sales = parseFudoSales({ data: [rawSale({}, { customer: { data: { id: "77" } } })] });
    byId.clientsByFudoId.set(77, "c-77");
    assert.equal(planSalesImport(byId).inserts[0].client_id, "c-77");

    const byPhone = base();
    byPhone.clientsByPhone.set("1168329555", "c-tel");
    assert.equal(planSalesImport(byPhone).inserts[0].client_id, "c-tel");
  });

  it("no reimporta: actualiza solo si el estado de Fudo avanza", () => {
    const input = base();
    input.sales = parseFudoSales({ data: [rawSale({ saleState: "DELIVERY-SENT" })] });
    input.existing = [{ id: "o1", fudo_order_id: 500, channel: "fudo", status: "Recibidos", fudo_sale_state: "IN-COURSE" }];
    const plan = planSalesImport(input);
    assert.equal(plan.inserts.length, 0);
    assert.deepEqual(plan.updates, [{ id: "o1", status: "En Camino", fudo_sale_state: "DELIVERY-SENT" }]);
  });

  it("nunca retrocede lo que el admin ya movió en el tablero", () => {
    const input = base();
    input.sales = parseFudoSales({ data: [rawSale({ saleState: "IN-COURSE" })] });
    input.existing = [{ id: "o1", fudo_order_id: 500, channel: "fudo", status: "En Camino", fudo_sale_state: "IN-COURSE" }];
    assert.deepEqual(planSalesImport(input).updates, []);
  });

  it("una anulación en Fudo cancela el pedido salvo que ya esté finalizado", () => {
    const input = base();
    input.sales = parseFudoSales({ data: [rawSale({ saleState: "CANCELED" })] });
    input.existing = [{ id: "o1", fudo_order_id: 500, channel: "fudo", status: "En Preparación", fudo_sale_state: "IN-COURSE" }];
    assert.deepEqual(planSalesImport(input).updates, [{ id: "o1", status: "Cancelado", fudo_sale_state: "CANCELED" }]);
    input.existing[0].status = "Finalizados";
    assert.deepEqual(planSalesImport(input).updates, [{ id: "o1", status: "Finalizados", fudo_sale_state: "CANCELED" }]);
  });

  it("no toca los pedidos que la app misma envió a Fudo (su estado lo maneja la app)", () => {
    const input = base();
    input.sales = parseFudoSales({ data: [rawSale({ saleState: "CLOSED" })] });
    input.existing = [{ id: "o1", fudo_order_id: 500, channel: "web", status: "Recibidos", fudo_sale_state: null }];
    const plan = planSalesImport(input);
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.updates.length, 0);
  });
});
