import { formatMoney, formatOrderId } from "./orders.ts";

/** Movimiento de saldo tal como lo recibe el cliente: sin descripción interna. Monto en pesos. */
export interface CreditMovementRow {
  id: string;
  delta: number;
  motivo: string;
  order_id: string | null;
  created_at: string;
}

export interface CreditMovement {
  id: string;
  label: string;
  amountText: string;
  negative: boolean;
  createdAt: string;
}

/** Motivo legible para el cliente; solo usa el motivo y el número corto del pedido. */
export function creditMovementLabel(motivo: string, orderId: string | null): string {
  switch (motivo) {
    case "reclamo":
      return "Reclamo resuelto";
    case "compra":
      return orderId ? `Usado en pedido ${formatOrderId(orderId)}` : "Usado en un pedido";
    case "devolucion":
      return "Devolución";
    case "ajuste":
      return "Ajuste";
    default:
      return "Movimiento";
  }
}

export function toCreditMovements(rows: readonly CreditMovementRow[]): CreditMovement[] {
  return rows.map((r) => ({
    id: r.id,
    label: creditMovementLabel(r.motivo, r.order_id),
    amountText: `${r.delta < 0 ? "−" : "+"}${formatMoney(Math.abs(r.delta))}`,
    negative: r.delta < 0,
    createdAt: r.created_at,
  }));
}
