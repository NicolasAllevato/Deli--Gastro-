import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rangeBounds } from "../src/lib/reports/range.ts";
import type { ReportOrder } from "../src/lib/reports/analytics.ts";
import {
  buildExecutiveSnapshot,
  buildInsights,
  byChannel,
  byZone,
  closingTimesByChannel,
  computeKpis,
  dailySeries,
  previousBounds,
  trend,
  type ReviewInput,
  type ZoneOf,
} from "../src/lib/reports/executive.ts";
import { DEFAULTS, mergeSettings } from "../src/lib/reports/executiveSettings.ts";
import mock from "../src/app/admin/ejecutivo/mock/executive.mock.json" with { type: "json" };

// 2026-10-04T15:00Z = domingo 4 de octubre, 12:00 en Buenos Aires (UTC-3).
const NOW = new Date("2026-10-04T15:00:00Z");
const RANGE = rangeBounds("last_7_days", NOW);

// Instante posterior a todos los pedidos de los tests: los no entregados ya están atrasados.
const LATER = new Date("2026-10-10T00:00:00Z").getTime();

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00Z`;

/** Pedido creado a las 14:00Z del día dado, entregado `deliverMin` minutos después (null = sin entregar). */
const order = (
  id: string,
  opts: { day?: string; deliverMin?: number | null; prepMin?: number | null; total?: number; status?: string; channel?: string; fudo_source?: string | null } = {},
): ReportOrder => {
  const day = opts.day ?? "2026-10-03";
  const created = new Date(at(day, "14:00")).getTime();
  const plus = (m: number | null | undefined) => (m == null ? null : new Date(created + m * 60_000).toISOString());
  return {
    id, client_id: "c1", status: opts.status ?? "Finalizados", total: opts.total ?? 1000, delivery_fee: 100,
    channel: opts.channel ?? "web", fudo_source: opts.fudo_source ?? null, payment_method: "Efectivo", items_desc: "1x Pizza",
    created_at: at(day, "14:00"), accepted_at: null,
    ready_at: plus(opts.prepMin === undefined ? 15 : opts.prepMin),
    picked_up_at: null,
    delivered_at: plus(opts.deliverMin === undefined ? 30 : opts.deliverMin),
  };
};

const zonesById: Record<string, string> = {};
const zoneOf: ZoneOf = (o) => zonesById[o.id] ?? null;
const inZone = (zone: string, o: ReportOrder): ReportOrder => {
  zonesById[o.id] = zone;
  return o;
};

const review = (rating: number, day = "2026-10-03", orderId: string | null = null): ReviewInput => ({
  rating, created_at: at(day, "20:00"), order_id: orderId, comment: rating <= 3 ? "Llegó frío" : null,
});

// SLA por defecto 40 + tolerancia 5 = 45 minutos.
const S = DEFAULTS;

describe("sin mutar ni copiar de más", () => {
  it("buildExecutiveSnapshot no muta entradas congeladas, con y sin zona", () => {
    const orders = Object.freeze([order("a"), order("b", { day: "2026-10-02" })].map((o) => Object.freeze(o)));
    const reviews = Object.freeze([] as ReviewInput[]);
    const zoneOf: ZoneOf = (o) => (o.id === "a" ? "Z1" : null);
    const base = { orders, reviews, bounds: RANGE, settings: DEFAULTS, zoneOf, now: LATER };
    const all = buildExecutiveSnapshot(base);
    const scoped = buildExecutiveSnapshot({ ...base, zone: "Z1" });
    assert.equal(all.kpis.current.orders, 2);
    assert.equal(scoped.kpis.current.orders, 1);
  });

  it("dailySeries agrupa muchos pedidos del mismo día", () => {
    const many = Array.from({ length: 500 }, (_, i) => order(`m${i}`));
    const series = dailySeries(many, RANGE, DEFAULTS, () => null, LATER);
    assert.equal(series.find((p) => p.date === "2026-10-03")?.orders, 500);
  });
});

describe("previousBounds", () => {
  it("devuelve el período anterior de igual duración", () => {
    const prev = previousBounds(RANGE);
    assert.equal(prev.to, RANGE.from);
    assert.equal(prev.from, "2026-09-21T03:00:00.000Z");
  });

  it("funciona con un día", () => {
    assert.deepEqual(previousBounds(rangeBounds("today", NOW)), rangeBounds("yesterday", NOW));
  });
});

describe("computeKpis", () => {
  const orders = [
    order("a", { deliverMin: 30, prepMin: 10 }), // a tiempo
    order("b", { deliverMin: 45, prepMin: 20 }), // justo en el límite: a tiempo
    order("c", { deliverMin: 46, prepMin: 30 }), // tarde por un minuto
    order("d", { deliverMin: null, prepMin: null, status: "En Camino" }), // sin entregar: cuenta como no puntual
    order("e", { status: "Cancelado", total: 9999 }), // cancelado: no cuenta
    order("f", { day: "2026-08-01" }), // fuera del período
  ];

  it("entrega a tiempo = entregados dentro de SLA + tolerancia sobre pedidos confirmados", () => {
    const k = computeKpis(orders, [], RANGE, S, zoneOf);
    assert.equal(k.orders, 4);
    assert.equal(k.delivered, 3);
    assert.equal(k.onTime, 50);
  });

  it("preparación = ready_at - created_at promedio en minutos", () => {
    assert.equal(computeKpis(orders, [], RANGE, S, zoneOf).prepMinutes, 20);
  });

  it("ticket = facturación neta sin cancelados sobre pedidos", () => {
    const k = computeKpis([order("a", { total: 1000 }), order("b", { total: 2000 }), order("c", { status: "Cancelado", total: 5000 })], [], RANGE, S, zoneOf);
    assert.equal(k.revenue, 3000);
    assert.equal(k.avgTicket, 1500);
  });

  it("CSAT = promedio de rating del período", () => {
    const k = computeKpis(orders, [review(5), review(4), review(2), review(5, "2026-08-01")], RANGE, S, zoneOf);
    assert.equal(k.csat, 3.67);
  });

  it("reclamos = reseñas con rating <= 3 sobre pedidos entregados", () => {
    const k = computeKpis(orders, [review(3, "2026-10-03", "a"), review(5, "2026-10-03", "b"), review(1, "2026-10-03", "c")], RANGE, S, zoneOf, LATER);
    assert.equal(k.complaints, 66.7); // 2 pedidos con reseña baja / 3 entregados
  });

  it("reclamos: las reseñas sin order_id o de pedidos no entregados no cuentan, y nunca pasa de 100", () => {
    const reviews = [review(1), review(1, "2026-10-03", "d"), review(1, "2026-10-03", "zzz")];
    assert.equal(computeKpis(orders, reviews, RANGE, S, zoneOf, LATER).complaints, 0);
    const many = Array.from({ length: 5 }, () => review(1, "2026-10-03", "a"));
    const k = computeKpis([order("a")], many, RANGE, S, zoneOf, LATER);
    assert.equal(k.complaints, 100);
  });

  it("puntualidad: un pedido en curso todavía en plazo no baja el porcentaje", () => {
    const fresh = order("fresh", { deliverMin: null, prepMin: null, status: "En Camino" });
    const createdMs = new Date(fresh.created_at).getTime();
    const inPlazo = createdMs + 10 * 60_000;
    const base = [order("ok", { deliverMin: 30 })];
    assert.equal(computeKpis([...base, fresh], [], RANGE, S, zoneOf, inPlazo).onTime, 100);
    assert.equal(computeKpis([fresh], [], RANGE, S, zoneOf, inPlazo).onTime, null);
    // Pasado el plazo (40 + 5 min) el pedido sin entregar cuenta como atrasado.
    assert.equal(computeKpis([...base, fresh], [], RANGE, S, zoneOf, createdMs + 46 * 60_000).onTime, 50);
  });

  it("puntualidad por día y por zona tampoco castiga pedidos en curso en plazo", () => {
    const fresh = inZone("ZP", order("fresh2", { deliverMin: null, prepMin: null }));
    const ok = inZone("ZP", order("ok2", { deliverMin: 30 }));
    const inPlazo = new Date(fresh.created_at).getTime() + 10 * 60_000;
    const day = dailySeries([ok, fresh], RANGE, S, zoneOf, inPlazo).find((p) => p.date === "2026-10-03");
    assert.equal(day?.onTime, 100);
    assert.equal(byZone([ok, fresh], RANGE, S, zoneOf, {}, inPlazo).find((r) => r.zoneId === "ZP")?.onTime, 100);
  });

  it("ignora total y rating no numéricos al agregar", () => {
    const bad = { ...order("bad", { total: 1000 }), total: "abc" as unknown as number };
    const k = computeKpis([order("a", { total: 1000 }), bad], [review(4), { ...review(1), rating: Number.NaN }], RANGE, S, zoneOf, LATER);
    assert.equal(k.revenue, 1000);
    assert.equal(k.avgTicket, 1000);
    assert.equal(k.csat, 4);
    assert.equal(byChannel([bad], RANGE)[0].revenue, 0);
  });

  it("usa el SLA de la zona del pedido", () => {
    const slow = inZone("Z3", order("z3", { deliverMin: 60 }));
    const fast = inZone("Z1", order("z1", { deliverMin: 60 }));
    const withOverride = mergeSettings(S, { sla: { byZone: { Z3: 55 } } }); // 55 + 5 = 60
    const k = computeKpis([slow, fast], [], RANGE, withOverride, zoneOf);
    assert.equal(k.onTime, 50);
  });

  it("la tolerancia es configurable", () => {
    const strict = mergeSettings(S, { sla: { toleranceMinutes: 0 } });
    assert.equal(computeKpis([order("b", { deliverMin: 45 })], [], RANGE, strict, zoneOf).onTime, 0);
  });

  it("un período vacío no divide por cero", () => {
    const k = computeKpis([], [], RANGE, S, zoneOf);
    assert.deepEqual(k, {
      orders: 0, delivered: 0, revenue: 0, onTime: null, prepMinutes: null, prepOnTarget: null, takeawayMinutes: null, totalMinutes: null,
      csat: null, complaints: null, avgTicket: null,
    });
  });

  it("mide pedidos de Fudo por updated_at y deja afuera los de una importación masiva", () => {
    const fudo = (id: string, type: string, minutes: number) => {
      const o = order(id, { deliverMin: null, prepMin: null, channel: "fudo" });
      return { ...o, fudo_sale_type: type, updated_at: new Date(Date.parse(o.created_at) + minutes * 60_000).toISOString() };
    };
    const k = computeKpis(
      [fudo("t1", "TAKEAWAY", 10), fudo("t2", "TAKEAWAY", 30), fudo("d1", "DELIVERY", 50), fudo("viejo", "TAKEAWAY", 26_000)],
      [], RANGE, S, zoneOf, LATER,
    );
    // El take away va aparte y en delivery el cierre incluye el viaje: no entran en preparación.
    assert.equal(k.prepMinutes, null);
    assert.equal(k.prepOnTarget, null);
    assert.equal(k.takeawayMinutes, 20);
    // El cierre de Fudo no es la entrega: no entra en puntualidad ni en el tiempo total.
    assert.equal(k.totalMinutes, null);
    assert.equal(k.onTime, null);
  });

  it("puntualidad y tiempo total salen solo de los pedidos con entrega real", () => {
    const web = order("w", { channel: "web", deliverMin: 30 });
    const cierre = { ...order("f", { channel: "fudo", deliverMin: 200 }), fudo_sale_type: "DELIVERY" };
    const k = computeKpis([web, cierre], [], RANGE, S, zoneOf, LATER);
    assert.equal(k.totalMinutes, 30);
    assert.equal(k.onTime, 100);
  });

  it("sin entregas no calcula reclamos", () => {
    const k = computeKpis([order("d", { deliverMin: null })], [review(1)], RANGE, S, zoneOf);
    assert.equal(k.complaints, null);
  });
});

describe("trend", () => {
  it("meta alta: subir es bueno", () => {
    assert.deepEqual(trend(92, 88, "higher"), { delta: 4, pct: 4.5, direction: "up", good: true });
    assert.equal(trend(80, 88, "higher").good, false);
  });

  it("meta baja: bajar es bueno", () => {
    assert.deepEqual(trend(15, 20, "lower"), { delta: -5, pct: -25, direction: "down", good: true });
    assert.equal(trend(22, 20, "lower").good, false);
  });

  it("sin cambio o sin dato", () => {
    assert.deepEqual(trend(5, 5, "higher"), { delta: 0, pct: 0, direction: "flat", good: null });
    assert.equal(trend(null, 5, "higher").delta, null);
    assert.equal(trend(5, null, "higher").good, null);
  });

  it("previo en cero no divide por cero", () => {
    assert.equal(trend(3, 0, "higher").pct, null);
  });
});

describe("dailySeries", () => {
  it("devuelve un punto por día, con huecos en null", () => {
    const orders = [
      order("a", { day: "2026-10-03", deliverMin: 30, prepMin: 10 }),
      order("b", { day: "2026-10-03", deliverMin: 90, prepMin: 20 }),
      order("c", { day: "2026-10-01", deliverMin: 30, prepMin: 12 }),
    ];
    const series = dailySeries(orders, RANGE, S, zoneOf);
    assert.equal(series.length, 7);
    assert.equal(series[0].date, "2026-09-28");
    assert.equal(series[6].date, "2026-10-04");
    const oct3 = series.find((p) => p.date === "2026-10-03");
    assert.deepEqual(oct3, { date: "2026-10-03", onTime: 50, prepMinutes: 15, orders: 2 });
    assert.deepEqual(series[0], { date: "2026-09-28", onTime: null, prepMinutes: null, orders: 0 });
  });
});

describe("byZone", () => {
  const orders = [
    inZone("Z1", order("z1a", { total: 1000 })),
    inZone("Z1", order("z1b", { total: 2000 })),
    inZone("Z2", order("z2a", { total: 500, deliverMin: 80 })),
    order("sz", { total: 300 }),
    inZone("Z1", order("z1old", { day: "2026-09-25", deliverMin: 100 })),
  ];

  it("agrupa demanda, facturación y puntualidad, con el período anterior", () => {
    const rows = byZone(orders, RANGE, S, zoneOf, { Z1: "Centro" });
    const z1 = rows.find((r) => r.zoneId === "Z1");
    assert.deepEqual(
      [z1?.label, z1?.orders, z1?.revenue, z1?.onTime, z1?.previousOnTime],
      ["Centro", 2, 3000, 100, 0],
    );
    assert.equal(rows.find((r) => r.zoneId === "Z2")?.onTime, 0);
    assert.equal(rows.find((r) => r.zoneId === "sin-zona")?.label, "Sin zona");
    assert.equal(rows[0].zoneId, "Z1");
  });

  it("oculta zonas no visibles y respeta etiquetas y SLA configurados", () => {
    const settings = mergeSettings(S, {
      zones: { Z2: { visible: false }, Z1: { label: "Microcentro", visible: true } },
      sla: { byZone: { Z1: 25 } },
    });
    const rows = byZone(orders, RANGE, settings, zoneOf);
    assert.equal(rows.some((r) => r.zoneId === "Z2"), false);
    const z1 = rows.find((r) => r.zoneId === "Z1");
    assert.equal(z1?.label, "Microcentro");
    assert.equal(z1?.slaMinutes, 25);
  });
});

describe("byChannel", () => {
  it("cuenta pedidos y participación sin cancelados", () => {
    const rows = byChannel(
      [order("a", { channel: "web" }), order("b", { channel: "web" }), order("c", { channel: "whatsapp", total: 3000 }),
        order("d", { channel: "mostrador", status: "Cancelado" })],
      RANGE,
    );
    // El canal con solo cancelados queda en la tabla con 0 pedidos (y 1 cancelado).
    assert.deepEqual(rows.map((r) => [r.channel, r.orders, r.share]), [["web", 2, 66.7], ["whatsapp", 1, 33.3], ["mostrador", 0, 0]]);
    assert.equal(rows[2].cancelled, 1);
    assert.equal(rows[1].revenue, 3000);
  });

  it("separa los pedidos de Fudo por su canal y cuenta cancelados aparte", () => {
    const rows = byChannel(
      [order("a", { channel: "fudo", fudo_source: "pedidosya", total: 4000 }),
        order("b", { channel: "fudo", fudo_source: "pedidosya", total: 2000 }),
        order("c", { channel: "fudo", fudo_source: "rappi" }),
        order("d", { channel: "fudo", fudo_source: null }),
        order("e", { channel: "fudo", fudo_source: "pedidosya", status: "Cancelado" })],
      RANGE,
    );
    const py = rows.find((r) => r.channel === "pedidosya");
    assert.deepEqual(rows.map((r) => r.channel).sort(), ["fudo", "pedidosya", "rappi"]);
    assert.equal(py?.orders, 2);
    assert.equal(py?.cancelled, 1);
    assert.equal(py?.revenue, 6000);
    assert.equal(py?.avgTicket, 3000);
  });

  it("período vacío da lista vacía", () => {
    assert.deepEqual(byChannel([], RANGE), []);
  });
});

describe("buildInsights", () => {
  const lateZone = (zone: string, count: number, day: string, late: boolean) =>
    Array.from({ length: count }, (_, i) => inZone(zone, order(`${zone}-${day}-${i}`, { day, deliverMin: late && i % 4 === 0 ? 30 : late ? 90 : 30 })));

  const snapshotWith = (orders: ReportOrder[], settings = S, reviews: ReviewInput[] = []) =>
    buildExecutiveSnapshot({ orders, reviews, bounds: RANGE, settings, zoneOf });

  it("avisa si la puntualidad de una zona cayó más que la sensibilidad", () => {
    const orders = [...lateZone("Z3", 8, "2026-10-02", true), ...lateZone("Z3", 8, "2026-09-25", false)];
    const snap = snapshotWith(orders);
    const drop = snap.insights.find((i) => i.text.includes("Z3"));
    assert.ok(drop);
    assert.equal(drop.severity, "critical");
    assert.match(drop.text, /cayó al 25%/);
    assert.ok(drop.action.length > 0);
  });

  it("la sensibilidad es configurable: con 90 puntos no dispara la regla de caída", () => {
    const orders = [...lateZone("Z3", 8, "2026-10-02", true), ...lateZone("Z3", 8, "2026-09-25", false)];
    const calm = mergeSettings(S, { copilot: { dropPoints: 90 } });
    const drop = snapshotWith(orders, calm).insights.find((i) => i.text.includes("cayó"));
    assert.equal(drop, undefined);
  });

  it("una regla desactivada no genera alertas", () => {
    const orders = lateZone("Z3", 8, "2026-10-02", true);
    const off = mergeSettings(S, { copilot: { rules: { kpiAlert: false, kpiMiss: false, zoneDrop: false, zoneLate: false } } });
    const texts = snapshotWith(orders, off).insights.map((i) => i.text);
    assert.deepEqual(texts, ["Todo en orden: los indicadores están dentro de las metas."]);
  });

  it("alerta de KPI crítica va antes que las advertencias", () => {
    const orders = [order("a", { deliverMin: 120, prepMin: 40 }), order("b", { deliverMin: 120, prepMin: 40 })];
    const insights = snapshotWith(orders).insights;
    assert.equal(insights[0].severity, "critical");
    assert.ok(insights.some((i) => i.text.startsWith("Tiempo de preparación")));
  });

  it("los KPIs ocultos no generan insights", () => {
    const orders = [order("a", { deliverMin: 120, prepMin: 40 })];
    const hidden = mergeSettings(S, { kpis: { onTime: { visible: false }, prepMinutes: { visible: false } } });
    const texts = snapshotWith(orders, hidden).insights.map((i) => i.text);
    assert.equal(texts.some((t) => t.startsWith("Entregas a tiempo") || t.startsWith("Tiempo de preparación")), false);
  });

  it("período vacío da un insight informativo", () => {
    const [only] = buildInsights(snapshotWith([]), S);
    assert.equal(only.severity, "info");
    assert.match(only.text, /no hay pedidos/);
  });

  it("zonas con muy pocos pedidos no disparan alertas", () => {
    const snap = snapshotWith([inZone("Z9", order("lonely", { deliverMin: 200 }))], mergeSettings(S, { kpis: { onTime: { visible: false } } }));
    assert.equal(snap.insights.some((i) => i.text.includes("Z9")), false);
  });
});

describe("buildExecutiveSnapshot", () => {
  const orders = [
    inZone("Z1", order("s1", { day: "2026-10-03", deliverMin: 30, prepMin: 10 })),
    inZone("Z1", order("s2", { day: "2026-10-02", deliverMin: 30, prepMin: 14 })),
    inZone("Z2", order("s3", { day: "2026-10-03", deliverMin: 100, prepMin: 25, channel: "whatsapp" })),
    inZone("Z1", order("p1", { day: "2026-09-25", deliverMin: 100, prepMin: 30 })),
  ];
  const reviews = [review(5, "2026-10-03", "s1"), review(2, "2026-10-03", "s3"), review(1, "2026-09-25", "p1")];
  const base = { orders, reviews, bounds: RANGE, settings: S, zoneOf, rangeKey: "last_7_days" as const, zoneNames: { Z1: "Centro", Z2: "Norte" } };

  it("expone truncated (false por defecto) y lo propaga", () => {
    assert.equal(buildExecutiveSnapshot(base).truncated, false);
    assert.equal(buildExecutiveSnapshot({ ...base, truncated: true }).truncated, true);
  });

  it("arma KPIs actuales y previos con tendencia, series, zonas, canales y reclamos", () => {
    const snap = buildExecutiveSnapshot(base);
    assert.equal(snap.range.key, "last_7_days");
    assert.equal(snap.kpis.current.orders, 3);
    assert.equal(snap.kpis.previous.orders, 1);
    assert.equal(snap.kpis.current.onTime, 66.7);
    assert.equal(snap.kpis.previous.onTime, 0);
    assert.equal(snap.trends.onTime.good, true);
    assert.equal(snap.trends.prepMinutes.good, true);
    assert.equal(snap.series.length, 7);
    assert.equal(snap.zones.length, 2);
    assert.equal(snap.channels.length, 2);
    assert.deepEqual(snap.complaints.map((c) => [c.orderId, c.rating]), [["s3", 2]]);
    assert.equal(snap.zone, null);
  });

  it("filtrar por zona recalcula KPIs, canales y reclamos pero deja el panel de zonas completo", () => {
    const snap = buildExecutiveSnapshot({ ...base, zone: "Z2" });
    assert.equal(snap.zone, "Z2");
    assert.equal(snap.kpis.current.orders, 1);
    assert.equal(snap.kpis.current.onTime, 0);
    assert.deepEqual(snap.channels.map((c) => c.channel), ["whatsapp"]);
    assert.equal(snap.complaints.length, 1);
    assert.equal(snap.zones.length, 2);
  });

  it("filtrar por una zona sin pedidos devuelve todo vacío sin romperse", () => {
    const snap = buildExecutiveSnapshot({ ...base, zone: "Z6" });
    assert.equal(snap.kpis.current.orders, 0);
    assert.equal(snap.kpis.current.onTime, null);
    assert.deepEqual(snap.channels, []);
    assert.equal(snap.trends.onTime.delta, null);
    assert.equal(snap.insights[0].severity, "info");
  });

  it("las opciones de zona incluyen las conocidas aunque no tengan pedidos y respetan los ajustes", () => {
    const settings = mergeSettings(S, { zones: { Z2: { visible: false }, Z1: { label: "Microcentro", visible: true } } });
    const snap = buildExecutiveSnapshot({ ...base, settings, zoneNames: { Z1: "Centro", Z2: "Norte", Z6: "Sur" } });
    assert.deepEqual(snap.zoneOptions.map((z) => z.id).sort(), ["Z1", "Z6"]);
    assert.equal(snap.zoneOptions.find((z) => z.id === "Z1")?.label, "Microcentro");
  });

  it("no muta los pedidos de entrada", () => {
    const copy = structuredClone(orders);
    buildExecutiveSnapshot(base);
    assert.deepEqual(orders, copy);
  });
});

describe("mock JSON", () => {
  it("tiene la forma exacta del snapshot", () => {
    const snap = buildExecutiveSnapshot({ orders: [], reviews: [], bounds: RANGE, settings: S, zoneOf });
    assert.deepEqual(Object.keys(mock).sort(), Object.keys(snap).sort());
    assert.deepEqual(Object.keys(mock.kpis.current).sort(), Object.keys(snap.kpis.current).sort());
    assert.deepEqual(Object.keys(mock.trends).sort(), Object.keys(snap.trends).sort());
    assert.deepEqual(Object.keys(mock.series[0]).sort(), ["date", "onTime", "orders", "prepMinutes"]);
    assert.deepEqual(Object.keys(mock.zones[0]).sort(), ["label", "onTime", "orders", "previousOnTime", "revenue", "slaMinutes", "zoneId"]);
    assert.deepEqual(Object.keys(mock.channels[0]).sort(), ["avgTicket", "cancelled", "channel", "delivered", "orders", "revenue", "share"]);
    assert.deepEqual(Object.keys(mock.insights[0]).sort(), ["action", "severity", "text"]);
    assert.equal(mock.series.length, 7);
    assert.deepEqual(mock.zones.map((z) => z.zoneId), ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6"]);
  });
});

describe("preparación separada de take away e integraciones", () => {
  const conListo = (id: string, minutes: number, over: Partial<ReportOrder>) => {
    const base = { ...order(id, { deliverMin: null, prepMin: null }), ...over };
    return { ...base, ready_at: new Date(Date.parse(base.created_at) + minutes * 60_000).toISOString() };
  };

  it("PedidosYa y Rappi no cuentan aunque tengan hora de listo", () => {
    const k = computeKpis(
      [
        conListo("local", 20, { channel: "fudo", fudo_source: "local", fudo_sale_type: "DELIVERY" }),
        conListo("peya", 90, { channel: "fudo", fudo_source: "pedidosya", fudo_sale_type: "DELIVERY" }),
        conListo("rappi", 90, { channel: "fudo", fudo_source: "rappi", fudo_sale_type: "DELIVERY" }),
      ],
      [], RANGE, S, zoneOf, LATER,
    );
    assert.equal(k.prepMinutes, 20);
    assert.equal(k.takeawayMinutes, null);
  });

  it("un take away con hora de listo suma solo a su propia medición", () => {
    const k = computeKpis([conListo("t", 12, { channel: "fudo", fudo_source: "local", fudo_sale_type: "TAKEAWAY" })], [], RANGE, S, zoneOf, LATER);
    assert.equal(k.prepMinutes, null);
    assert.equal(k.takeawayMinutes, 12);
  });
});

describe("closingTimesByChannel", () => {
  const closed = (id: string, minutes: number | null, over: Partial<ReportOrder> = {}) => {
    const base = { ...order(id), ...over };
    return { ...base, status: "Finalizados", delivered_at: minutes === null ? null : new Date(Date.parse(base.created_at) + minutes * 60_000).toISOString() };
  };
  const fudo = (source: string, type: string) => ({ channel: "fudo", fudo_source: source, fudo_sale_type: type });

  it("usa la mediana, excluye cierres de más de 4 h y cuenta los que no tienen hora", () => {
    const rows = closingTimesByChannel([
      closed("a", 30, fudo("rappi", "DELIVERY")), closed("b", 40, fudo("rappi", "DELIVERY")),
      closed("c", 100, fudo("rappi", "DELIVERY")), closed("d", 1300, fudo("rappi", "DELIVERY")),
      closed("e", null, fudo("rappi", "DELIVERY")),
    ], RANGE);
    assert.deepEqual(rows, [{ channel: "rappi", source: "cierre", medianMinutes: 40, measured: 3, excluded: 1, withoutTime: 1, notMeasurable: 0 }]);
  });

  it("take away y mostrador no se miden, y los medibles van primero", () => {
    const rows = closingTimesByChannel([
      closed("a", 2, fudo("morfy", "TAKEAWAY")), closed("b", 2, { channel: "mostrador" }), closed("c", 35, { channel: "web" }),
    ], RANGE);
    assert.equal(rows[0].channel, "web");
    assert.equal(rows[0].source, "entrega");
    assert.equal(rows[0].medianMinutes, 35);
    assert.deepEqual(rows.slice(1).map((r) => [r.medianMinutes, r.measured, r.notMeasurable]), [[null, 0, 1], [null, 0, 1]]);
  });

  it("ignora cancelados y pedidos en curso", () => {
    assert.deepEqual(closingTimesByChannel([{ ...closed("a", 30), status: "Cancelado" }, { ...closed("b", 30), status: "En Camino" }], RANGE), []);
  });
});
