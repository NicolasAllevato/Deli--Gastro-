/**
 * Pedidos nacidos en Fudo (`channel = 'fudo'`, migración 023): los importa el Worker `fudo-gateway` desde las
 * ventas de delivery y take away. El local ya los gestiona en Fudo, así que la app NO dispara sobre ellos
 * avisos de WhatsApp, puntos, encuestas, reembolsos ni reenvío a Fudo. Solo se ven en el tablero y suman en reportes.
 */
export function isFudoOrigin(order: { channel: string | null | undefined }): boolean {
  return order.channel === "fudo";
}

const SALE_TYPE_LABEL: Readonly<Record<string, string>> = { DELIVERY: "Delivery", TAKEAWAY: "Take away", "EAT-IN": "Salón" };

/** Etiqueta para la tarjeta del tablero; null si el pedido no vino de Fudo. */
export function fudoOriginLabel(order: { channel: string | null | undefined; fudo_sale_type?: string | null }): string | null {
  if (!isFudoOrigin(order)) return null;
  const type = order.fudo_sale_type ? SALE_TYPE_LABEL[order.fudo_sale_type] : undefined;
  return type ? `Fudo · ${type}` : "Fudo";
}
