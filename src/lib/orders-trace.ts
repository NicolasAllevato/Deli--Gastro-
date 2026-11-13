/**
 * Rastreo completo de un pedido en el admin (/admin/pedidos/[id]): TODAS las
 * columnas de `orders`, agrupadas por sección. Solo lectura y solo staff.
 * tests/orders-trace.test.ts falla si aparece una columna que no está acá.
 */
import { formatMoney } from "./orders.ts";

export type TraceKind = "text" | "money" | "date" | "bool" | "json" | "number" | "coord" | "meters" | "client" | "error";

export interface TraceField {
  key: string;
  label: string;
  kind: TraceKind;
}

export interface TraceSection {
  id: "pedido" | "tiempos" | "entrega" | "fudo";
  title: string;
  fields: readonly TraceField[];
}

export const ORDER_TRACE_SECTIONS: readonly TraceSection[] = [
  {
    id: "pedido",
    title: "Pedido",
    fields: [
      { key: "id", label: "Id", kind: "text" },
      { key: "status", label: "Estado", kind: "text" },
      { key: "client_id", label: "Cliente", kind: "client" },
      { key: "customer_name", label: "Nombre informado (Fudo)", kind: "text" },
      { key: "channel", label: "Canal", kind: "text" },
      { key: "items_desc", label: "Productos", kind: "text" },
      { key: "total", label: "Total", kind: "money" },
      { key: "delivery_fee", label: "Envío", kind: "money" },
      { key: "payment_method", label: "Medio de pago", kind: "text" },
      { key: "notes", label: "Notas", kind: "text" },
      { key: "points_earned", label: "Puntos acreditados", kind: "number" },
    ],
  },
  {
    id: "tiempos",
    title: "Tiempos",
    fields: [
      { key: "created_at", label: "Creado", kind: "date" },
      { key: "updated_at", label: "Última actualización", kind: "date" },
      { key: "accepted_at", label: "Aceptado", kind: "date" },
      { key: "ready_at", label: "Listo", kind: "date" },
      { key: "picked_up_at", label: "Retirado por el repartidor", kind: "date" },
      { key: "delivered_at", label: "Entregado", kind: "date" },
      { key: "survey_sent_at", label: "Encuesta enviada", kind: "date" },
    ],
  },
  {
    id: "entrega",
    title: "Entrega",
    fields: [
      { key: "delivery_address", label: "Dirección", kind: "text" },
      { key: "delivery_lat", label: "Latitud pedida", kind: "coord" },
      { key: "delivery_lng", label: "Longitud pedida", kind: "coord" },
      { key: "geocode_attempts", label: "Intentos de geocodificación", kind: "number" },
      { key: "courier_name", label: "Repartidor", kind: "text" },
      { key: "delivered_lat", label: "Latitud de entrega", kind: "coord" },
      { key: "delivered_lng", label: "Longitud de entrega", kind: "coord" },
      { key: "delivered_accuracy_m", label: "Precisión del GPS", kind: "meters" },
      { key: "delivered_in_app", label: "Entrega confirmada en la app", kind: "bool" },
    ],
  },
  {
    id: "fudo",
    title: "Fudo",
    fields: [
      { key: "fudo_order_id", label: "Id de venta en Fudo", kind: "text" },
      { key: "fudo_sync_status", label: "Estado de sincronización", kind: "text" },
      { key: "fudo_attempts", label: "Intentos", kind: "number" },
      { key: "fudo_synced_at", label: "Sincronizado", kind: "date" },
      { key: "fudo_error", label: "Error", kind: "error" },
      { key: "fudo_sale_type", label: "Tipo de venta", kind: "text" },
      { key: "fudo_sale_state", label: "Estado de la venta", kind: "text" },
      { key: "fudo_source", label: "Origen", kind: "text" },
      { key: "fudo_payment", label: "Pago", kind: "json" },
      { key: "fudo_payments", label: "Pagos", kind: "json" },
    ],
  },
];

export const ORDER_TRACE_KEYS: readonly string[] = ORDER_TRACE_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export const EMPTY = "—";

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** JSON legible: objetos/arrays con sangría; strings que contienen JSON se parsean. */
export function prettyJson(v: unknown): string {
  if (isEmpty(v)) return EMPTY;
  let value = v;
  if (typeof v === "string") {
    try {
      value = JSON.parse(v);
    } catch {
      return v;
    }
  }
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

/** Texto a mostrar para un valor. Vacío → "—", nunca se oculta. */
export function formatTraceValue(v: unknown, kind: TraceKind): string {
  if (isEmpty(v)) return EMPTY;
  switch (kind) {
    case "money":
      return formatMoney(Number(v));
    case "date": {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime())
        ? String(v)
        : d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "medium" });
    }
    case "bool":
      return v === true || v === 1 || v === "true" ? "Sí" : "No";
    case "json":
      return prettyJson(v);
    case "coord":
      return Number(v).toFixed(6);
    case "meters":
      return `${Math.round(Number(v))} m`;
    case "number":
      return String(v);
    default:
      return String(v);
  }
}

/** Punto pedido y punto de entrega, si ambos tienen coordenadas válidas. */
export function tracePoints(order: Record<string, unknown>): {
  requested: { lat: number; lng: number } | null;
  delivered: { lat: number; lng: number } | null;
} {
  const pt = (lat: unknown, lng: unknown) =>
    isEmpty(lat) || isEmpty(lng) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))
      ? null
      : { lat: Number(lat), lng: Number(lng) };
  return { requested: pt(order.delivery_lat, order.delivery_lng), delivered: pt(order.delivered_lat, order.delivered_lng) };
}
