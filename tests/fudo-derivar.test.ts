import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAssignCourier, isFudoDelivery } from "../src/lib/fudo/origin.ts";

const { planSalesImport, parseFudoSales } = await import("../workers/fudo-gateway/src/sales.ts");

const delivery = { channel: "fudo", fudo_sale_type: "DELIVERY" };

describe("derivar deliveries de Fudo", () => {
  it("un delivery de Fudo se puede asignar aunque siga en Recibidos", () => {
    assert.equal(canAssignCourier({ ...delivery, status: "Recibidos" }), true);
    assert.equal(isFudoDelivery(delivery), true);
  });
  it("un take away de Fudo o un pedido web en Recibidos no", () => {
    assert.equal(canAssignCourier({ channel: "fudo", fudo_sale_type: "TAKEAWAY", status: "Recibidos" }), false);
    assert.equal(canAssignCourier({ channel: "web", status: "Recibidos" }), false);
  });
  it("nada se asigna si ya terminó", () => {
    assert.equal(canAssignCourier({ ...delivery, status: "Finalizados" }), false);
  });
});

describe("«Enviado» de Fudo como hora de salida", () => {
  const sales = (saleState: string) =>
    parseFudoSales({ data: [{ type: "Sale", id: "500", attributes: { createdAt: "2026-11-04T00:00:00Z", closedAt: null, total: 100, saleType: "DELIVERY", saleState }, relationships: { items: { data: [] }, payments: { data: [] } } }] });
  const update = (saleState: string, over: Record<string, unknown> = {}) =>
    planSalesImport({
      sales: sales(saleState), itemsBySale: new Map(), productsByFudoId: new Map(), clientsByFudoId: new Map(), clientsByPhone: new Map(), now: "2026-11-04T00:30:00Z",
      existing: [{ id: "o1", fudo_order_id: 500, channel: "fudo", status: "Recibidos", fudo_sale_state: "IN-COURSE", client_id: "c", fudo_source: "local", ...over }],
    }).updates[0];

  it("guarda la salida al detectar el cambio", () => {
    assert.equal(update("DELIVERY-SENT").picked_up_at, "2026-11-04T00:30:00Z");
  });
  it("no pisa la salida que marcó el repartidor", () => {
    assert.equal(update("DELIVERY-SENT", { picked_up_at: "2026-11-04T00:10:00Z" }).picked_up_at, undefined);
  });
  it("«Listo para entregar» no es una salida", () => {
    const u = update("READY-TO-DELIVER");
    assert.equal(u.picked_up_at, undefined);
    assert.ok(u.ready_at);
  });
});
