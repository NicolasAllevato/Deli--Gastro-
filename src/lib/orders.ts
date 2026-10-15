import type { ClientTier, OrderStatus } from "@/types/database";

/** Transiciones válidas del ciclo de vida de un pedido. */
export const NEXT_STATUSES: Record<OrderStatus, readonly OrderStatus[]> = {
  Recibidos: ["En Preparación", "Cancelado"],
  "En Preparación": ["En Camino", "Cancelado"],
  "En Camino": ["Finalizados", "Cancelado"],
  Finalizados: [],
  Cancelado: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT_STATUSES[from].includes(to);
}

export const ACTIVE_STATUSES: readonly OrderStatus[] = ["Recibidos", "En Preparación", "En Camino"];

export function isActiveStatus(status: OrderStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Pasos que ve el cliente en el seguimiento (el pedido cancelado se muestra aparte). */
export const TRACKING_STEPS: ReadonlyArray<{ status: OrderStatus; label: string; hint: string }> = [
  { status: "Recibidos", label: "Pedido recibido", hint: "El local confirmó tu pedido" },
  { status: "En Preparación", label: "En preparación", hint: "Estamos cocinando" },
  { status: "En Camino", label: "En camino", hint: "El repartidor salió hacia tu dirección" },
  { status: "Finalizados", label: "Entregado", hint: "¡Que lo disfrutes!" },
];

export interface OrderLine {
  qty: number;
  name: string;
}

/** "2x Pizza · 1x Papas" → líneas. Si el texto es libre devuelve una sola línea. */
export function parseItems(itemsDesc: string): OrderLine[] {
  return itemsDesc
    .split(" · ")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = /^(\d+)x\s+(.+)$/.exec(chunk);
      return m ? { qty: Number(m[1]), name: m[2]! } : { qty: 1, name: chunk };
    });
}

export function buildItemsDesc(lines: ReadonlyArray<OrderLine>): string {
  return lines.map((l) => `${l.qty}x ${l.name}`).join(" · ");
}

export function formatOrderId(uuid: string): string {
  return `#${uuid.slice(0, 8).toUpperCase()}`;
}

export function formatMoney(value: number): string {
  return `$${Number(value).toLocaleString("es-AR")}`;
}

export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/** Puntos ganados por un pedido: `puntos_por_100` por cada $100. */
export function pointsForTotal(total: number, puntosPor100: number): number {
  return Math.max(0, Math.floor((total / 100) * puntosPor100));
}

export interface TierRule {
  nombre: string;
  desde: number;
}

const DEFAULT_TIERS: readonly TierRule[] = [
  { nombre: "Bronce", desde: 0 },
  { nombre: "Plata", desde: 150 },
  { nombre: "Oro", desde: 300 },
  { nombre: "Platino", desde: 500 },
];

const TIER_NAMES: readonly ClientTier[] = ["Bronce", "Plata", "Oro", "Platino"];

/** Nivel de fidelidad para un saldo de puntos (usa los umbrales por defecto). */
export function tierForPoints(points: number, tiers: readonly TierRule[] = DEFAULT_TIERS): ClientTier {
  const match = [...tiers]
    .sort((a, b) => b.desde - a.desde)
    .find((t) => points >= t.desde);
  const name = match?.nombre as ClientTier | undefined;
  return name && TIER_NAMES.includes(name) ? name : "Bronce";
}

/** Qué hace una recompensa sobre el pedido: un porcentaje del subtotal o un producto de una categoría sin cargo. */
export type RewardEffect =
  | { tipo: "porcentaje"; porcentaje: number }
  | { tipo: "producto"; categoria: string; tope?: number };

export interface Reward {
  id: string;
  nombre: string;
  descripcion: string;
  puntosRequeridos: number;
  efecto: RewardEffect;
}

export const REWARDS: readonly Reward[] = [
  {
    id: "postre", nombre: "Postre gratis", puntosRequeridos: 200,
    descripcion: "Cualquier postre del menú",
    efecto: { tipo: "producto", categoria: "Postres" },
  },
  {
    id: "bebida", nombre: "Bebida gratis", puntosRequeridos: 150,
    descripcion: "Bebida de hasta $2.000",
    efecto: { tipo: "producto", categoria: "Bebidas", tope: 2000 },
  },
  {
    id: "descuento", nombre: "10% de descuento", puntosRequeridos: 100,
    descripcion: "En tu próximo pedido",
    efecto: { tipo: "porcentaje", porcentaje: 10 },
  },
];

export const PAYMENT_METHODS = ["Efectivo", "Tarjeta", "Mercado Pago"] as const;
