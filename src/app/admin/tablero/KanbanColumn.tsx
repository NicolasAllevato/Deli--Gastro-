import { canAssignCourier } from "@/lib/fudo/origin";
import Link from "next/link";
import { Bike, CreditCard, Flame, History, MapPin, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { fudoOriginLabel } from "@/lib/fudo/origin";
import { elapsedTone, formatMoney, formatOrderId } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";
import { completedAt } from "@/lib/reports/completion";
import type { OrderStatus } from "@/types/database";
import { OrderTimer } from "./OrderTimer";

export interface ColumnConfig {
  status: OrderStatus;
  title: string;
  dot: string;
  chip: string;
  chipIcon: LucideIcon;
  /** Franja superior de la columna y borde izquierdo de cada tarjeta. */
  accentTop: string;
  accentLeft: string;
  /** Tinte del encabezado de la columna, para separar bien cada etapa. */
  headerTint: string;
  /** Acción principal que avanza el pedido a la siguiente etapa. */
  action?: { label: string; next: OrderStatus; className: string };
  cancellable: boolean;
}

export const COLUMNS: readonly ColumnConfig[] = [
  {
    status: "Recibidos",
    title: "Recibidos",
    dot: "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]",
    chip: "text-red-600 bg-red-50 border-red-100",
    chipIcon: History,
    accentTop: "border-t-red-500",
    accentLeft: "border-l-red-500",
    headerTint: "bg-red-500/10",
    action: {
      label: "Aceptar pedido",
      next: "En Preparación",
      className: "bg-brand-orange text-white hover:bg-orange-600",
    },
    cancellable: true,
  },
  {
    status: "En Preparación",
    title: "Preparación",
    dot: "bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]",
    chip: "text-yellow-700 bg-yellow-50 border-yellow-100",
    chipIcon: Flame,
    accentTop: "border-t-yellow-400",
    accentLeft: "border-l-yellow-400",
    headerTint: "bg-yellow-400/10",
    action: {
      label: "Listo para enviar",
      next: "En Camino",
      className: "bg-yellow-400 text-gray-900 hover:bg-yellow-500",
    },
    cancellable: true,
  },
  {
    status: "En Camino",
    title: "En Camino",
    dot: "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]",
    chip: "text-blue-700 bg-blue-50 border-blue-100",
    chipIcon: Bike,
    accentTop: "border-t-blue-500",
    accentLeft: "border-l-blue-500",
    headerTint: "bg-blue-500/10",
    action: {
      label: "Entregado",
      next: "Finalizados",
      className: "bg-blue-600 text-white hover:bg-blue-700",
    },
    cancellable: true,
  },
  {
    status: "Finalizados",
    title: "Finalizados",
    dot: "bg-brand-green shadow-[0_0_10px_rgba(75,253,57,0.6)]",
    chip: "",
    chipIcon: History,
    accentTop: "border-t-brand-green",
    accentLeft: "border-l-brand-green",
    headerTint: "bg-brand-green/10",
    cancellable: false,
  },
];

/** Pedidos de la columna que superan el umbral de demora. */
export function countLate(status: OrderStatus, orders: readonly EnrichedOrder[], now: number): number {
  if (status === "Finalizados") return 0;
  return orders.filter((o) => elapsedTone(now - new Date(o.created_at).getTime()) === "late").length;
}

interface Props {
  config: ColumnConfig;
  orders: readonly EnrichedOrder[];
  busyId: string | null;
  /** Reloj compartido (ms) para los contadores de cada pedido. */
  now: number;
  onMove: (id: string, next: OrderStatus) => void;
  /** Repartidores disponibles; vacío = no se muestra el selector. */
  couriers?: readonly string[];
  onAssign?: (id: string, courierName: string | null) => void;
  className?: string;
}

export function KanbanColumn({ config, orders, busyId, now, onMove, couriers = [], onAssign, className }: Props) {
  const lateCount = countLate(config.status, orders, now);
  const done = config.status === "Finalizados";

  return (
    <section
      aria-label={`Pedidos ${config.title}`}
      className={cn(
        "min-w-0 flex flex-col rounded-2xl neumorphic-inset border-t-4 overflow-hidden",
        config.accentTop,
        className,
      )}
    >
      <header className={cn("flex items-center justify-between gap-2 px-3 py-2.5 shrink-0", config.headerTint)}>
        <span className="flex items-center gap-2 min-w-0">
          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", config.dot)} aria-hidden />
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-800 truncate">{config.title}</h3>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {lateCount > 0 && (
            <span className="text-[10px] font-black uppercase tracking-wide text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
              {lateCount} demorado{lateCount > 1 ? "s" : ""}
            </span>
          )}
          <span className="min-w-7 text-center px-2 py-0.5 rounded-lg text-xs font-black text-gray-800 bg-[var(--app-surface)] border border-[var(--app-border)]">
            {orders.length}
          </span>
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2">
        {orders.length === 0 && (
          <p className="py-8 text-center text-xs font-bold text-gray-500">Sin pedidos</p>
        )}

        {orders.map((order) => {
          const busy = busyId === order.id;
          const closedAt = done ? completedAt(order) : null;
          const meta = [
            order.payment_method && { icon: CreditCard, text: order.payment_method, tone: "text-gray-500" },
            order.courier_name && { icon: Bike, text: order.courier_name, tone: "text-blue-600" },
          ].filter(Boolean) as { icon: LucideIcon; text: string; tone: string }[];

          return (
            <article
              key={order.id}
              className={cn(
                "page-fade shrink-0 rounded-xl border border-[var(--app-border)] border-l-4 bg-[var(--app-surface)] shadow-[var(--app-card-shadow)] p-2.5 space-y-1.5 transition-transform hover:-translate-y-0.5",
                config.accentLeft,
                done && "opacity-75",
                busy && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/admin/pedidos/${order.id}`}
                  className="font-headline font-bold text-sm text-gray-800 hover:text-brand-orange transition-colors"
                >
                  {formatOrderId(order.id)}
                </Link>
                {done && !closedAt ? (
                  <span className="shrink-0 text-[11px] font-bold text-gray-500">Sin hora de cierre</span>
                ) : (
                  <OrderTimer startedAt={order.created_at} endedAt={closedAt} now={now} />
                )}
              </div>

              <div className="flex justify-between items-baseline gap-2">
                <p className="font-bold text-sm text-gray-700 truncate">{order.client_name}</p>
                <span className="text-sm font-black text-brand-orange shrink-0">{formatMoney(order.total)}</span>
              </div>

              {fudoOriginLabel(order) && (
                <span className="badge-blue self-start px-2 py-0.5 rounded-full text-[10px] font-bold">{fudoOriginLabel(order)}</span>
              )}

              <p className="text-xs text-gray-600 line-clamp-2" title={order.items_desc}>{order.items_desc}</p>

              {order.delivery_address && (
                <p className="flex items-center gap-1 text-[11px] text-gray-500" title={order.delivery_address}>
                  <MapPin size={11} className="shrink-0" aria-hidden />
                  <span className="truncate">{order.delivery_address}</span>
                </p>
              )}

              {meta.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {meta.map(({ icon: Icon, text, tone }) => (
                    <span key={text} className={cn("flex items-center gap-1 text-[11px] font-bold", tone)}>
                      <Icon size={11} aria-hidden />
                      {text}
                    </span>
                  ))}
                </div>
              )}

              {order.notes && (
                <p className="text-[11px] text-gray-500 italic line-clamp-1" title={order.notes}>
                  &ldquo;{order.notes}&rdquo;
                </p>
              )}

              {onAssign && couriers.length > 0 && canAssignCourier(order) && (
                <label className="flex items-center gap-2 text-[11px] font-bold text-gray-500">
                  <Bike size={12} aria-hidden />
                  <span className="sr-only">Repartidor del pedido {formatOrderId(order.id)}</span>
                  <select
                    value={order.courier_name ?? ""}
                    disabled={busy}
                    onChange={(e) => onAssign(order.id, e.target.value || null)}
                    className="flex-1 min-w-0 rounded-lg neumorphic-inset px-2 py-1 text-[11px] text-gray-700 bg-transparent disabled:opacity-50"
                  >
                    <option value="">Sin asignar</option>
                    {order.courier_name && !couriers.includes(order.courier_name) && (
                      <option value={order.courier_name}>{order.courier_name}</option>
                    )}
                    {couriers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
              )}

              {config.action && (
                <div className="flex gap-1.5 pt-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onMove(order.id, config.action!.next)}
                    className={cn(
                      "flex-1 min-h-9 py-1.5 rounded-lg transition-colors font-bold text-xs disabled:opacity-50",
                      config.action.className,
                    )}
                  >
                    {config.action.label}
                  </button>
                  {config.cancellable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onMove(order.id, "Cancelado")}
                      aria-label={`Cancelar pedido ${formatOrderId(order.id)}`}
                      className="min-h-9 px-2.5 rounded-lg border border-[var(--app-border)] text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      <XCircle size={16} aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
