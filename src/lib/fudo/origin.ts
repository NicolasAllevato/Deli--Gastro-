/**
 * Pedidos nacidos en Fudo (`channel = 'fudo'`, migración 023): los importa el Worker `fudo-gateway` desde las
 * ventas de delivery y take away. El local ya los gestiona en Fudo, así que la app NO dispara sobre ellos
 * avisos de WhatsApp, puntos, encuestas, reembolsos ni reenvío a Fudo. Solo se ven en el tablero y suman en reportes.
 */
export function isFudoOrigin(order: { channel: string | null | undefined }): boolean {
  return order.channel === "fudo";
}

const SALE_TYPE_LABEL: Readonly<Record<string, string>> = { DELIVERY: "Delivery", TAKEAWAY: "Take away", "EAT-IN": "Salón" };

/** Canal de venta deducido por el gateway del medio de pago de Fudo (migración 024). */
const SOURCE_LABEL: Readonly<Record<string, string>> = { pedidosya: "PedidosYa", rappi: "Rappi", morfy: "Morfy", local: "Fudo" };

/** Clase de color de la etiqueta según el canal (las de apps se distinguen del local). */
export function fudoSourceBadge(source: string | null | undefined): string {
  if (source === "pedidosya") return "badge-red";
  if (source === "rappi") return "badge-orange";
  if (source === "morfy") return "badge-yellow";
  return "badge-blue";
}

/** Etiqueta del pedido («PedidosYa · Delivery», «Fudo · Take away»…); null si el pedido no vino de Fudo. */
export function fudoOriginLabel(order: {
  channel: string | null | undefined;
  fudo_sale_type?: string | null;
  fudo_source?: string | null;
}): string | null {
  if (!isFudoOrigin(order)) return null;
  const source = (order.fudo_source && SOURCE_LABEL[order.fudo_source]) || "Fudo";
  const type = order.fudo_sale_type ? SALE_TYPE_LABEL[order.fudo_sale_type] : undefined;
  return type ? `${source} · ${type}` : source;
}
