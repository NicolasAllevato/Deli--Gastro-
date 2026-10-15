import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clientSummaries, type ExportClient } from "../src/lib/reports/clientExport.ts";
import type { ReportOrder } from "../src/lib/reports/analytics.ts";
import { toCsv } from "../src/lib/reports/csv.ts";

const NOW = new Date("2026-10-10T15:00:00Z");

const client = (over: Partial<ExportClient> & { id: string }): ExportClient => ({
  name: "Cliente",
  phone: null,
  address: null,
  tier: "Bronce",
  total_points: 0,
  wa_marketing_opt_in: false,
  created_at: "2026-01-01T12:00:00Z",
  ...over,
});

const order = (over: Partial<ReportOrder> & { id: string }): ReportOrder => ({
  client_id: "c1",
  status: "Finalizados",
  total: 1000,
  delivery_fee: 0,
  channel: "web",
  payment_method: null,
  items_desc: "1x Pizza",
  created_at: "2026-10-01T12:00:00Z",
  accepted_at: null,
  ready_at: null,
  picked_up_at: null,
  delivered_at: null,
  ...over,
});

describe("clientSummaries", () => {
  it("incluye clientes sin pedidos con ceros y campos nulos", () => {
    const [row] = clientSummaries([client({ id: "c1" })], [], null, NOW);
    assert.equal(row!.orders, 0);
    assert.equal(row!.cancelled, 0);
    assert.equal(row!.spent, 0);
    assert.equal(row!.avgTicket, 0);
    assert.equal(row!.firstOrderAt, null);
    assert.equal(row!.lastOrderAt, null);
    assert.equal(row!.daysSinceLast, null);
    assert.equal(row!.topProduct, "");
  });

  it("agrega pedidos, excluye cancelados del gasto y los cuenta aparte", () => {
    const orders = [
      order({ id: "o1", total: 1000, created_at: "2026-09-01T12:00:00Z", items_desc: "2x Pizza · 1x Fugazzeta" }),
      order({ id: "o2", total: 3000, created_at: "2026-10-05T12:00:00Z", items_desc: "1x Fugazzeta" }),
      order({ id: "o3", total: 9999, status: "Cancelado", created_at: "2026-10-08T12:00:00Z" }),
    ];
    const [row] = clientSummaries([client({ id: "c1", name: "Ana" })], orders, null, NOW);
    assert.equal(row!.name, "Ana");
    assert.equal(row!.orders, 2);
    assert.equal(row!.cancelled, 1);
    assert.equal(row!.spent, 4000);
    assert.equal(row!.avgTicket, 2000);
    assert.equal(row!.firstOrderAt, "2026-09-01T12:00:00Z");
    assert.equal(row!.lastOrderAt, "2026-10-05T12:00:00Z");
    assert.equal(row!.daysSinceLast, 5);
    // Pizza 2 vs Fugazzeta 2: empate, gana el orden alfabético.
    assert.equal(row!.topProduct, "Fugazzeta");
  });

  it("el rango filtra qué pedidos cuentan", () => {
    const orders = [
      order({ id: "o1", total: 1000, created_at: "2026-08-01T12:00:00Z" }),
      order({ id: "o2", total: 500, created_at: "2026-10-05T12:00:00Z" }),
    ];
    const bounds = { from: "2026-10-01T03:00:00.000Z", to: "2026-11-01T03:00:00.000Z" };
    const [row] = clientSummaries([client({ id: "c1" })], orders, bounds, NOW);
    assert.equal(row!.orders, 1);
    assert.equal(row!.spent, 500);
    // Primer y último pedido son históricos aunque el período sea más corto.
    assert.equal(row!.firstOrderAt, "2026-08-01T12:00:00Z");
    assert.equal(row!.lastOrderAt, "2026-10-05T12:00:00Z");
  });

  it("un cliente activo fuera del período no figura como inactivo", () => {
    const orders = [order({ id: "o1", total: 900, created_at: "2026-10-09T15:00:00Z" })];
    const bounds = { from: "2026-09-01T03:00:00.000Z", to: "2026-10-01T03:00:00.000Z" };
    const [row] = clientSummaries([client({ id: "c1" })], orders, bounds, NOW);
    assert.equal(row!.orders, 0);
    assert.equal(row!.spent, 0);
    assert.equal(row!.lastOrderAt, "2026-10-09T15:00:00Z");
    assert.equal(row!.daysSinceLast, 1);
  });

  it("ignora pedidos de mostrador y de clientes desconocidos", () => {
    const orders = [order({ id: "o1", client_id: null }), order({ id: "o2", client_id: "otro" })];
    const [row] = clientSummaries([client({ id: "c1" })], orders, null, NOW);
    assert.equal(row!.orders, 0);
  });

  it("no muta las entradas y ordena por gasto descendente", () => {
    const clients = [client({ id: "c1", name: "B" }), client({ id: "c2", name: "A" })];
    const orders = [order({ id: "o1", client_id: "c2", total: 700 })];
    const frozen = JSON.stringify([clients, orders]);
    const rows = clientSummaries(clients, orders, null, NOW);
    assert.equal(JSON.stringify([clients, orders]), frozen);
    assert.deepEqual(rows.map((r) => r.name), ["A", "B"]);
  });
});

describe("export de clientes en CSV", () => {
  it("neutraliza nombres y direcciones que parecen fórmulas", () => {
    const csv = toCsv(["Nombre", "Dirección"], [["=HYPERLINK(\"x\")", "+54 calle"], ["@cmd", "-1"]]);
    assert.match(csv, /^Nombre,Dirección\r\n"'=HYPERLINK\(""x""\)",'\+54 calle\r\n'@cmd,'-1\r\n$/);
  });
});
