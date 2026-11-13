import { formatMoney } from "@/lib/orders";
import { productSales, NO_COMBO_RULES, type ComboRules } from "@/lib/reports/product-sales";
import type { ReportOrder } from "@/lib/reports/analytics";
import type { Bounds } from "@/lib/reports/range";

export interface DailySummary {
  /** YYYY-MM-DD (Buenos Aires). */
  date: string;
  orders: number;
  delivered: number;
  cancelled: number;
  inProgress: number;
  /** Ventas: suma de los pedidos no cancelados. */
  revenue: number;
  avgTicket: number;
  avgDeliveryMinutes: number | null;
  /** Combos más vendidos (unidades). */
  topCombos: Array<{ name: string; qty: number }>;
  /** Productos más vendidos: sueltos más los que vinieron dentro de combos. */
  topProducts: Array<{ name: string; qty: number }>;
  channels: Array<{ channel: string; orders: number; revenue: number }>;
}

const TOP_PRODUCTS = 3;

/** Resumen de los pedidos creados dentro de `bounds` (el día a resumir). */
export function buildDailySummary(
  orders: readonly ReportOrder[],
  bounds: Bounds,
  date: string,
  catalog: { priceByName?: ReadonlyMap<string, number>; comboRules?: ComboRules } = {},
): DailySummary {
  const day = orders.filter((o) => o.created_at >= bounds.from && o.created_at < bounds.to);
  const live = day.filter((o) => o.status !== "Cancelado");
  const delivered = day.filter((o) => o.status === "Finalizados");
  const revenue = live.reduce((sum, o) => sum + o.total, 0);

  const minutes = delivered.flatMap((o) =>
    o.delivered_at ? [(new Date(o.delivered_at).getTime() - new Date(o.created_at).getTime()) / 60_000] : [],
  );

  const sales = productSales(live, bounds, catalog.priceByName ?? new Map(), TOP_PRODUCTS, catalog.comboRules ?? NO_COMBO_RULES);

  const byChannel = new Map<string, { orders: number; revenue: number }>();
  for (const order of live) {
    const current = byChannel.get(order.channel) ?? { orders: 0, revenue: 0 };
    byChannel.set(order.channel, { orders: current.orders + 1, revenue: current.revenue + order.total });
  }

  return {
    date,
    orders: day.length,
    delivered: delivered.length,
    cancelled: day.length - live.length,
    inProgress: live.length - delivered.length,
    revenue,
    avgTicket: live.length > 0 ? Math.round(revenue / live.length) : 0,
    avgDeliveryMinutes: minutes.length > 0 ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
    topCombos: sales.combos.map((r) => ({ name: r.name, qty: r.units })),
    topProducts: sales.products.map((r) => ({ name: r.name, qty: r.units })),
    channels: [...byChannel.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([channel, v]) => ({ channel, ...v })),
  };
}

/** "2026-10-16" → "16/10/2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail(summary: DailySummary, businessName: string): RenderedEmail {
  const when = formatDate(summary.date);
  const rows: Array<[string, string]> = [
    ["Pedidos del día", String(summary.orders)],
    ["Entregados", String(summary.delivered)],
    ["En curso", String(summary.inProgress)],
    ["Cancelados", String(summary.cancelled)],
    ["Ventas", formatMoney(summary.revenue)],
    ["Ticket promedio", formatMoney(summary.avgTicket)],
    ["Tiempo medio de entrega", summary.avgDeliveryMinutes === null ? "—" : `${summary.avgDeliveryMinutes} min`],
  ];
  const top = summary.topProducts.map((p) => `${p.qty}x ${p.name}`);
  const combos = summary.topCombos.map((p) => `${p.qty}x ${p.name}`);
  const channels = summary.channels.map((c) => `${c.channel}: ${c.orders} (${formatMoney(c.revenue)})`);

  const text = [
    `${businessName} · Resumen del ${when}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Combos más vendidos: ${combos.length > 0 ? combos.join(", ") : "—"}`,
    `Productos más vendidos: ${top.length > 0 ? top.join(", ") : "—"}`,
    `Por canal: ${channels.length > 0 ? channels.join(" · ") : "—"}`,
  ].join("\n");

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#222">
<h2 style="margin:0 0 4px">${escapeHtml(businessName)}</h2>
<p style="margin:0 0 16px;color:#666">Resumen del ${when}</p>
<table style="width:100%;border-collapse:collapse">
${rows.map(([l, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${escapeHtml(l)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right"><strong>${escapeHtml(v)}</strong></td></tr>`).join("\n")}
</table>
<p style="margin:16px 0 4px"><strong>Combos más vendidos:</strong> ${escapeHtml(combos.length > 0 ? combos.join(", ") : "—")}</p>
<p style="margin:4px 0"><strong>Productos más vendidos:</strong> ${escapeHtml(top.length > 0 ? top.join(", ") : "—")}</p>
<p style="margin:0"><strong>Por canal:</strong> ${escapeHtml(channels.length > 0 ? channels.join(" · ") : "—")}</p>
</div>`;

  return { subject: `${businessName} · Resumen del ${when}`, text, html };
}

/** Parámetros de la plantilla de WhatsApp `resumen_diario` (en el orden de {{1}}…{{7}}). */
export function whatsappParams(summary: DailySummary, businessName: string, recipientName: string): string[] {
  return [
    recipientName,
    businessName,
    formatDate(summary.date),
    String(summary.orders),
    `${summary.delivered} entregados y ${summary.cancelled} cancelados`,
    formatMoney(summary.revenue),
    formatMoney(summary.avgTicket),
  ];
}
