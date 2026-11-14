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
  /** Opciones elegidas dentro del producto (gustos de un combo de Fudo): "Combo (2x Carne, 1x Humita)". */
  options?: OrderLine[];
}

/**
 * Paréntesis final con opciones "Nx nombre, Nx nombre (detalle)". "(8 porciones)" solo no lo es: queda en el nombre.
 */
const OPTION = String.raw`\d+x [^,()]+(?: \([^()]*\))?`;
const OPTIONS_SUFFIX = new RegExp(String.raw`^(.+?) \((${OPTION}(?:, ${OPTION})*)\)$`);

function parseLine(chunk: string): OrderLine {
  const m = /^(\d+)x\s+(.+)$/.exec(chunk);
  const qty = m ? Number(m[1]) : 1;
  const rest = m ? m[2]! : chunk;
  const o = OPTIONS_SUFFIX.exec(rest);
  if (!o) return { qty, name: rest };
  const options = o[2]!.split(", ").map((opt) => {
    const om = /^(\d+)x (.+)$/.exec(opt)!;
    return { qty: Number(om[1]), name: om[2]! };
  });
  return { qty, name: o[1]!, options };
}

/** "2x Pizza · 1x Papas" → líneas. Si el texto es libre devuelve una sola línea. */
export function parseItems(itemsDesc: string): OrderLine[] {
  return itemsDesc
    .split(" · ")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(parseLine);
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

export interface PointsLine {
  price: number;
  qty: number;
  /** Puntos por cada $100 propios del plato; `null` = hereda los de su categoría. */
  productRate: number | null;
  /** Puntos por cada $100 de la categoría; `null` = la categoría no da puntos. */
  categoryRate: number | null;
}

/**
 * Puntos de un pedido por plato: si el plato tiene puntos propios (aunque sean 0) solo cuentan esos;
 * si no, los de su categoría; si ninguno define puntos, la línea no suma.
 */
export function pointsForLines(lines: ReadonlyArray<PointsLine>): number {
  const raw = lines.reduce((sum, l) => {
    const rate = l.productRate ?? l.categoryRate ?? 0;
    return sum + (l.price * l.qty / 100) * rate;
  }, 0);
  return Math.max(0, Math.floor(raw + 1e-9));
}

/** Puntos ganados por un pedido sin detalle de platos (pedidos viejos): `puntos_por_100` por cada $100. */
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

/** Tiempo transcurrido como `mm:ss` (o `h:mm:ss` pasada la hora). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type ElapsedTone = "ok" | "warn" | "late";

/** Urgencia según el tiempo que lleva el pedido en el proceso. */
export function elapsedTone(ms: number): ElapsedTone {
  const minutes = ms / 60_000;
  if (minutes >= 25) return "late";
  if (minutes >= 10) return "warn";
  return "ok";
}
