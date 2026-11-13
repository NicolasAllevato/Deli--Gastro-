import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidates,
  courierMayActOn,
  courierMaySelfAssign,
  courierPicker,
  needsAutoAssign,
  parseAssignMode,
  pickCourier,
} from "../src/lib/courier-assign.ts";

const { planSalesImport, parseFudoSales } = await import("../workers/fudo-gateway/src/sales.ts");

describe("modo de asignación: valor guardado", () => {
  it("sin valor o con uno desconocido es libre", () => {
    assert.equal(parseAssignMode(undefined), "libre");
    assert.equal(parseAssignMode(null), "libre");
    assert.equal(parseAssignMode("cualquiera"), "libre");
  });
  it("respeta manual y automático", () => {
    assert.equal(parseAssignMode("manual"), "manual");
    assert.equal(parseAssignMode("automatico"), "automatico");
  });
});

describe("compuerta del repartidor (403 fuera de libre)", () => {
  it("en libre puede tomar un pedido sin asignar", () => {
    assert.equal(courierMaySelfAssign("libre"), true);
    assert.equal(courierMayActOn("libre", null, "Nora"), true);
  });
  it("en manual y automático no puede autoasignarse", () => {
    assert.equal(courierMayActOn("manual", null, "Nora"), false);
    assert.equal(courierMayActOn("automatico", null, "Nora"), false);
    assert.equal(courierMayActOn("manual", "Beto", "Nora"), false);
  });
  it("lo suyo lo sigue entregando en cualquier modo", () => {
    assert.equal(courierMayActOn("manual", "Nora", "Nora"), true);
    assert.equal(courierMayActOn("automatico", "Nora", "Nora"), true);
  });
});

describe("elección en modo automático", () => {
  it("gana el de menos pedidos en curso", () => {
    const c = buildCandidates(["Nora", "Beto"], ["Nora", "Nora", "Beto"], new Map());
    assert.equal(pickCourier(c), "Beto");
  });
  it("empate: el que hace más que no recibe uno (nunca primero)", () => {
    const last = new Map([["Nora", "2026-11-12T20:00:00Z"], ["Beto", "2026-11-12T19:00:00Z"]]);
    assert.equal(pickCourier(buildCandidates(["Nora", "Beto"], [], last)), "Beto");
    assert.equal(pickCourier(buildCandidates(["Nora", "Beto", "Ana"], [], last)), "Ana");
  });
  it("sin habilitados no asigna", () => {
    assert.equal(pickCourier(buildCandidates([], ["Nora"], new Map())), null);
  });
  it("varios pedidos en una corrida se reparten", () => {
    const next = courierPicker(buildCandidates(["Nora", "Beto"], [], new Map()), "2026-11-12T21:00:00Z");
    assert.deepEqual([next(), next()].sort(), ["Beto", "Nora"]);
  });
  it("solo aplica a deliveries sin repartidor, y solo en automático", () => {
    const web = { courier_name: null, channel: "web", delivery_address: "Calle 1" };
    assert.equal(needsAutoAssign("automatico", web), true);
    assert.equal(needsAutoAssign("libre", web), false);
    assert.equal(needsAutoAssign("manual", web), false);
    assert.equal(needsAutoAssign("automatico", { ...web, courier_name: "Beto" }), false);
    assert.equal(needsAutoAssign("automatico", { ...web, delivery_address: null }), false);
    assert.equal(needsAutoAssign("automatico", { courier_name: null, channel: "fudo", fudo_sale_type: "TAKEAWAY" }), false);
    assert.equal(needsAutoAssign("automatico", { courier_name: null, channel: "fudo", fudo_sale_type: "DELIVERY" }), true);
  });
});

describe("Fudo en modo automático", () => {
  const sales = (saleType: string, saleState: string) =>
    parseFudoSales({ data: [{ type: "Sale", id: "700", attributes: { createdAt: "2026-11-10T00:00:00Z", closedAt: null, total: 100, saleType, saleState }, relationships: { items: { data: [] }, payments: { data: [] } } }] });
  const plan = (saleType: string, over: Record<string, unknown> = {}) =>
    planSalesImport({
      sales: sales(saleType, "DELIVERY-SENT"), itemsBySale: new Map(), productsByFudoId: new Map(), clientsByFudoId: new Map(), clientsByPhone: new Map(),
      now: "2026-11-10T00:30:00Z", soleCourier: null, assignCourier: () => "Ana",
      existing: [{ id: "o1", fudo_order_id: 700, channel: "fudo", status: "Recibidos", fudo_sale_state: "IN-COURSE", client_id: "c", fudo_source: "local", courier_name: null, ...over }],
    });

  it("asigna con el selector automático al pasar a «Enviado»", () => {
    assert.deepEqual(plan("DELIVERY").autoAssign, [{ id: "o1", courier_name: "Ana" }]);
  });
  it("nunca pisa un repartidor asignado", () => {
    assert.deepEqual(plan("DELIVERY", { courier_name: "Beto" }).autoAssign, []);
  });
  it("no aplica a take away", () => {
    assert.deepEqual(plan("TAKEAWAY").autoAssign, []);
  });
});
