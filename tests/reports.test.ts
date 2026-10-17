import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rangeBounds } from "../src/lib/reports/range.ts";
import {
  deliveryTimes,
  newVsReturning,
  recurringCustomers,
  reviewsSummary,
  salesSummary,
  topProducts,
  type ReportOrder,
} from "../src/lib/reports/analytics.ts";
import { toCsv } from "../src/lib/reports/csv.ts";
import { createDemoReportsLlm, detectRange } from "../src/lib/reports/demoLlm.ts";

// 2026-10-04T15:00Z = domingo 4 de octubre, 12:00 en Buenos Aires (UTC-3).
const NOW = new Date("2026-10-04T15:00:00Z");

describe("rangeBounds (hora de Buenos Aires)", () => {
  it("hoy y ayer van de 00:00 a 00:00 hora local", () => {
    assert.deepEqual(rangeBounds("today", NOW), { from: "2026-10-04T03:00:00.000Z", to: "2026-10-05T03:00:00.000Z" });
    assert.deepEqual(rangeBounds("yesterday", NOW), { from: "2026-10-03T03:00:00.000Z", to: "2026-10-04T03:00:00.000Z" });
  });

  it("los últimos 7 y 30 días incluyen hoy", () => {
    assert.equal(rangeBounds("last_7_days", NOW).from, "2026-09-28T03:00:00.000Z");
    assert.equal(rangeBounds("last_7_days", NOW).to, "2026-10-05T03:00:00.000Z");
    assert.equal(rangeBounds("last_30_days", NOW).from, "2026-09-05T03:00:00.000Z");
  });

  it("este mes y el mes pasado", () => {
    assert.deepEqual(rangeBounds("this_month", NOW), { from: "2026-10-01T03:00:00.000Z", to: "2026-11-01T03:00:00.000Z" });
    assert.deepEqual(rangeBounds("last_month", NOW), { from: "2026-09-01T03:00:00.000Z", to: "2026-10-01T03:00:00.000Z" });
  });

  it("de madrugada UTC todavía es el día anterior en Buenos Aires", () => {
    const lateNight = new Date("2026-10-04T02:30:00Z"); // 23:30 del 3 de octubre
    assert.equal(rangeBounds("today", lateNight).from, "2026-10-03T03:00:00.000Z");
  });

  it("el mes pasado funciona al cruzar el año", () => {
    const january = new Date("2027-01-15T15:00:00Z");
    assert.deepEqual(rangeBounds("last_month", january), { from: "2026-12-01T03:00:00.000Z", to: "2027-01-01T03:00:00.000Z" });
  });
});

const order = (partial: Partial<ReportOrder> & Pick<ReportOrder, "id">): ReportOrder => ({
  client_id: "c1",
  status: "Finalizados",
  total: 1000,
  delivery_fee: 100,
  channel: "web",
  payment_method: "Efectivo",
  items_desc: "1x Pizza",
  created_at: "2026-10-04T14:00:00Z",
  accepted_at: null,
  ready_at: null,
  picked_up_at: null,
  delivered_at: null,
  ...partial,
});

const RANGE = rangeBounds("last_7_days", NOW);

describe("salesSummary", () => {
  const orders = [
    order({ id: "1", total: 1000, delivery_fee: 100 }),
    order({ id: "2", total: 3000, delivery_fee: 200, channel: "whatsapp", payment_method: "Tarjeta", created_at: "2026-10-03T14:00:00Z" }),
    order({ id: "3", status: "Cancelado", total: 9999 }),
    order({ id: "4", total: 500, created_at: "2026-08-01T14:00:00Z" }), // fuera del período
  ];

  it("suma ventas y envíos sin contar cancelados ni pedidos fuera del período", () => {
    const s = salesSummary(orders, RANGE, "none");
    assert.equal(s.orders, 2);
    assert.equal(s.revenue, 4000);
    assert.equal(s.deliveryFees, 300);
    assert.equal(s.avgTicket, 2000);
  });

  it("informa los cancelados y la tasa de cancelación", () => {
    const s = salesSummary(orders, RANGE, "none");
    assert.equal(s.cancelled, 1);
    assert.equal(s.cancellationRate, 0.333);
  });

  it("agrupa por día (hora local), canal y forma de pago", () => {
    const byDay = salesSummary(orders, RANGE, "day").groups;
    assert.deepEqual(byDay, [
      { key: "2026-10-03", orders: 1, revenue: 3000 },
      { key: "2026-10-04", orders: 1, revenue: 1000 },
    ]);
    assert.deepEqual(salesSummary(orders, RANGE, "channel").groups.map((g) => g.key).sort(), ["web", "whatsapp"]);
    assert.deepEqual(salesSummary(orders, RANGE, "payment").groups.map((g) => g.key).sort(), ["Efectivo", "Tarjeta"]);
  });

  it("sin pedidos no divide por cero", () => {
    const s = salesSummary([], RANGE, "none");
    assert.deepEqual([s.orders, s.revenue, s.avgTicket, s.cancellationRate], [0, 0, 0, 0]);
  });
});

describe("topProducts", () => {
  const orders = [
    order({ id: "1", items_desc: "2x Pizza Margarita · 1x Limonada" }),
    order({ id: "2", items_desc: "1x Pizza Margarita" }),
    order({ id: "3", items_desc: "5x Limonada", status: "Cancelado" }),
  ];
  const prices = new Map([["Pizza Margarita", 12000], ["Limonada", 2600]]);

  it("cuenta unidades y estima ingresos, ignorando cancelados", () => {
    assert.deepEqual(topProducts(orders, RANGE, prices, 5), [
      { name: "Pizza Margarita", units: 3, estimatedRevenue: 36000 },
      { name: "Limonada", units: 1, estimatedRevenue: 2600 },
    ]);
  });

  it("respeta el límite y deja el ingreso en 0 si el producto ya no tiene precio", () => {
    const result = topProducts(orders, RANGE, new Map(), 1);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.estimatedRevenue, 0);
  });
});

describe("recurringCustomers", () => {
  const clients = [
    { id: "a", name: "Ana" },
    { id: "b", name: "Beto" },
  ];
  const orders = [
    order({ id: "1", client_id: "a", total: 1000, created_at: "2026-10-01T14:00:00Z" }),
    order({ id: "2", client_id: "a", total: 2000, created_at: "2026-10-03T14:00:00Z" }),
    order({ id: "3", client_id: "b", total: 500 }),
    order({ id: "4", client_id: "a", status: "Cancelado", total: 7000 }),
  ];

  it("lista a quienes pidieron al menos N veces, con lo gastado y el último pedido", () => {
    assert.deepEqual(recurringCustomers(orders, RANGE, clients, 2), [
      { name: "Ana", orders: 2, spent: 3000, lastOrderAt: "2026-10-03T14:00:00Z" },
    ]);
  });

  it("con mínimo 1 incluye a todos, ordenados por cantidad", () => {
    assert.deepEqual(recurringCustomers(orders, RANGE, clients, 1).map((c) => c.name), ["Ana", "Beto"]);
  });
});

describe("newVsReturning", () => {
  const orders = [
    order({ id: "1", client_id: "old", created_at: "2026-08-01T14:00:00Z" }), // cliente de antes
    order({ id: "2", client_id: "old", created_at: "2026-10-02T14:00:00Z" }),
    order({ id: "3", client_id: "new", created_at: "2026-10-03T14:00:00Z" }),
    order({ id: "4", client_id: "new", created_at: "2026-10-04T14:00:00Z" }),
  ];

  it("separa clientes nuevos de los que ya habían pedido antes del período", () => {
    assert.deepEqual(newVsReturning(orders, RANGE), {
      newCustomers: 1,
      returningCustomers: 1,
      ordersFromNew: 2,
      ordersFromReturning: 1,
    });
  });
});

describe("deliveryTimes", () => {
  it("promedia cocina, espera, ruta y total de los pedidos entregados en el período", () => {
    const orders = [
      order({
        id: "1", created_at: "2026-10-04T10:00:00Z", accepted_at: "2026-10-04T10:02:00Z", ready_at: "2026-10-04T10:20:00Z",
        picked_up_at: "2026-10-04T10:25:00Z", delivered_at: "2026-10-04T10:45:00Z",
      }),
      order({
        id: "2", created_at: "2026-10-04T11:00:00Z", accepted_at: "2026-10-04T11:02:00Z", ready_at: "2026-10-04T11:12:00Z",
        picked_up_at: "2026-10-04T11:15:00Z", delivered_at: "2026-10-04T11:35:00Z",
      }),
    ];
    assert.deepEqual(deliveryTimes(orders, RANGE), {
      delivered: 2, avgKitchen: 14, avgDispatchWait: 4, avgRoute: 20, avgTotal: 40,
    });
  });

  it("devuelve null cuando no hay datos", () => {
    assert.deepEqual(deliveryTimes([order({ id: "1" })], RANGE), {
      delivered: 0, avgKitchen: null, avgDispatchWait: null, avgRoute: null, avgTotal: null,
    });
  });
});

describe("reviewsSummary", () => {
  it("promedio, distribución y cantidad de reseñas bajas del período", () => {
    const reviews = [
      { rating: 5, created_at: "2026-10-03T10:00:00Z" },
      { rating: 4, created_at: "2026-10-04T10:00:00Z" },
      { rating: 2, created_at: "2026-10-04T11:00:00Z" },
      { rating: 1, created_at: "2026-07-01T11:00:00Z" }, // fuera del período
    ];
    assert.deepEqual(reviewsSummary(reviews, RANGE), {
      count: 3,
      average: 3.7,
      distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 },
      lowRated: 1,
    });
  });

  it("sin reseñas el promedio es null", () => {
    assert.equal(reviewsSummary([], RANGE).average, null);
  });
});

describe("toCsv", () => {
  it("arma encabezado y filas, escapando comas, comillas y saltos de línea", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'dijo "hola"'], ["l1\nl2", "ok"]]);
    assert.equal(csv, 'a,b\r\n"x,y","dijo ""hola"""\r\n"l1\nl2",ok\r\n');
  });

  it("neutraliza celdas que Excel interpretaría como fórmula", () => {
    const csv = toCsv(["nombre"], [["=HYPERLINK(\"http://malo\")"], ["+54 9 11"], ["@usuario"], ["-5"]]);
    for (const line of csv.trim().split("\r\n").slice(1)) {
      assert.match(line, /^"?'/, line);
    }
  });

  it("los números no se tocan", () => {
    assert.equal(toCsv(["n"], [[-5], [12.5]]), "n\r\n-5\r\n12.5\r\n");
  });
});

describe("analista de demostración", () => {
  it("detectRange entiende el período pedido y usa 7 días por defecto", () => {
    assert.equal(detectRange("ventas de hoy"), "today");
    assert.equal(detectRange("¿cuánto vendí ayer?"), "yesterday");
    assert.equal(detectRange("ventas del mes pasado"), "last_month");
    assert.equal(detectRange("ventas de este mes"), "this_month");
    assert.equal(detectRange("últimos 30 días"), "last_30_days");
    assert.equal(detectRange("cuánto vendí"), "last_7_days");
  });

  it("pide la herramienta que corresponde según la pregunta", async () => {
    const llm = createDemoReportsLlm();
    const first = async (text: string) =>
      (await llm.chat([{ role: "user", content: text }], [])).message.tool_calls?.[0]?.function.name;

    assert.equal(await first("cuanto vendi esta semana?"), "get_sales_summary");
    assert.equal(await first("productos más vendidos"), "get_top_products");
    assert.equal(await first("clientes frecuentes"), "get_recurring_customers");
    assert.equal(await first("tiempos de entrega"), "get_delivery_times");
    assert.equal(await first("hola"), undefined);
  });
});
