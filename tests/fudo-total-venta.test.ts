import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { planSalesImport, parseFudoSales } = await import("../workers/fudo-gateway/src/sales.ts");

const sales = (total: number, saleState: string) =>
  parseFudoSales({ data: [{ type: "Sale", id: "500", attributes: { createdAt: "2026-11-04T00:13:30Z", closedAt: "2026-11-04T01:00:00Z", total, saleType: "TAKEAWAY", saleState }, relationships: { items: { data: [] }, payments: { data: [] } } }] });
const plan = (s: ReturnType<typeof parseFudoSales>, total: number | string | null | undefined, status = "Finalizados", state = "CLOSED") =>
  planSalesImport({
    sales: s, itemsBySale: new Map(), productsByFudoId: new Map(), clientsByFudoId: new Map(), clientsByPhone: new Map(),
    existing: [{ id: "o1", fudo_order_id: 500, channel: "fudo", status, fudo_sale_state: state, client_id: "c", fudo_source: "local", total }],
  }).updates;

describe("total de una venta ya importada", () => {
  it("se actualiza si en Fudo cambió", () => {
    assert.equal(plan(sales(1500, "CLOSED"), 1000)[0].total, 1500);
  });
  it("acepta el total como texto y no genera cambios si es igual", () => {
    assert.equal(plan(sales(1000, "CLOSED"), "1000.00").length, 0);
  });
  it("no toca el total de una venta anulada", () => {
    const updates = plan(sales(0, "CANCELED"), 1000);
    assert.equal(updates[0].total, undefined);
  });
  it("sin total previo no compara", () => {
    assert.equal(plan(sales(1000, "CLOSED"), undefined).length, 0);
  });
});
