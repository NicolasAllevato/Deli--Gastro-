import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shiftDay, soleCourier } from "../src/lib/courier-shift-day.ts";

const { planSalesImport, parseFudoSales } = await import("../workers/fudo-gateway/src/sales.ts");

describe("día de trabajo del repartidor", () => {
  it("cambia a las 6 de la mañana de Argentina (9 UTC)", () => {
    assert.equal(shiftDay(new Date("2026-11-10T08:59:00Z")), "2026-11-09");
    assert.equal(shiftDay(new Date("2026-11-10T09:00:00Z")), "2026-11-10");
  });
  it("el turno de la noche, pasada la medianoche, sigue siendo el mismo día", () => {
    assert.equal(shiftDay(new Date("2026-11-10T02:30:00Z")), "2026-11-09"); // 23:30 en Argentina
    assert.equal(shiftDay(new Date("2026-11-10T05:00:00Z")), "2026-11-09"); // 02:00 en Argentina
  });
});

describe("único repartidor habilitado", () => {
  it("con uno solo, es ese", () => assert.equal(soleCourier(["Nora"]), "Nora"));
  it("con ninguno o con varios, no se asigna", () => {
    assert.equal(soleCourier([]), null);
    assert.equal(soleCourier(["Nora", "Beto"]), null);
  });
  it("un mismo nombre repetido cuenta como uno", () => assert.equal(soleCourier(["Nora", "Nora"]), "Nora"));
});

describe("asignación automática al marcar «Enviado» en Fudo", () => {
  const sales = (saleType: string, saleState: string) =>
    parseFudoSales({ data: [{ type: "Sale", id: "700", attributes: { createdAt: "2026-11-10T00:00:00Z", closedAt: null, total: 100, saleType, saleState }, relationships: { items: { data: [] }, payments: { data: [] } } }] });
  const plan = (saleType: string, saleState: string, over: Record<string, unknown> = {}, sole: string | null = "Nora") =>
    planSalesImport({
      sales: sales(saleType, saleState), itemsBySale: new Map(), productsByFudoId: new Map(), clientsByFudoId: new Map(), clientsByPhone: new Map(),
      now: "2026-11-10T00:30:00Z", soleCourier: sole,
      existing: [{ id: "o1", fudo_order_id: 700, channel: "fudo", status: "Recibidos", fudo_sale_state: "IN-COURSE", client_id: "c", fudo_source: "local", courier_name: null, ...over }],
    });

  it("un delivery recién enviado se le asigna al único repartidor habilitado", () => {
    assert.deepEqual(plan("DELIVERY", "DELIVERY-SENT").autoAssign, [{ id: "o1", courier_name: "Nora" }]);
  });
  it("sin repartidor único no se asigna", () => {
    assert.deepEqual(plan("DELIVERY", "DELIVERY-SENT", {}, null).autoAssign, []);
  });
  it("no pisa un repartidor ya asignado", () => {
    assert.deepEqual(plan("DELIVERY", "DELIVERY-SENT", { courier_name: "Beto" }).autoAssign, []);
  });
  it("un take away enviado no se asigna", () => {
    assert.deepEqual(plan("TAKEAWAY", "DELIVERY-SENT").autoAssign, []);
  });
  it("solo al detectar el cambio: si ya estaba enviado no se vuelve a asignar", () => {
    assert.deepEqual(plan("DELIVERY", "DELIVERY-SENT", { fudo_sale_state: "DELIVERY-SENT", status: "En Camino" }).autoAssign, []);
  });
  it("una venta nueva que ya llega enviada nace con el repartidor", () => {
    const fresh = planSalesImport({
      sales: sales("DELIVERY", "DELIVERY-SENT"), itemsBySale: new Map(), productsByFudoId: new Map(), clientsByFudoId: new Map(), clientsByPhone: new Map(),
      now: "2026-11-10T00:30:00Z", soleCourier: "Nora", existing: [],
    });
    assert.equal(fresh.inserts[0]?.courier_name, "Nora");
  });
});
