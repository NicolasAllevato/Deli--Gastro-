import Link from "next/link";
import { Bike, CreditCard, Flame, History, MapPin, XCircle, type LucideIcon } from "lucide-react";
import { formatMoney, formatOrderId, minutesSince } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";
import type { OrderStatus } from "@/types/database";

export interface ColumnConfig {
  status: OrderStatus;
  title: string;
  dot: string;
  chip: string;
  chipIcon: LucideIcon;
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
    action: {
      label: "Aceptar Pedido",
      next: "En Preparación",
      className: "neumorphic-inset text-brand-orange hover:text-orange-600",
    },
    cancellable: true,
  },
  {
    status: "En Preparación",
    title: "Preparación",
    dot: "bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]",
    chip: "text-yellow-700 bg-yellow-50 border-yellow-100",
    chipIcon: Flame,
    action: {
      label: "Listo para Enviar",
      next: "En Camino",
      className: "neumorphic-inset text-yellow-600 hover:text-yellow-700",
    },
    cancellable: true,
  },
  {
    status: "En Camino",
    title: "En Camino",
    dot: "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]",
    chip: "text-blue-700 bg-blue-50 border-blue-100",
    chipIcon: Bike,
    action: {
      label: "Entregado",
      next: "Finalizados",
      className: "bg-brand-orange text-white shadow-[0_3px_8px_rgba(124,58,237,0.3)] hover:bg-orange-600",
    },
    cancellable: true,
  },
  {
    status: "Finalizados",
    title: "Finalizados",
    dot: "bg-brand-green shadow-[0_0_10px_rgba(75,253,57,0.6)]",
    chip: "",
    chipIcon: History,
    cancellable: false,
  },
];

interface Props {
  config: ColumnConfig;
  orders: readonly EnrichedOrder[];
  busyId: string | null;
  onMove: (id: string, next: OrderStatus) => void;
  /** Repartidores disponibles; vacío = no se muestra el selector. */
  couriers?: readonly string[];
  onAssign?: (id: string, courierName: string | null) => void;
}

const ASSIGNABLE: readonly OrderStatus[] = ["En Preparación", "En Camino"];

export function KanbanColumn({ config, orders, busyId, onMove, couriers = [], onAssign }: Props) {
  const Chip = config.chipIcon;

  return (
    <div className="w-[85vw] sm:w-[260px] lg:w-auto min-w-0 shrink-0 lg:shrink snap-start neumorphic-inset rounded-2xl p-3 flex flex-col gap-3 h-full overflow-y-auto custom-scrollbar">
      <div className="flex items-center justify-between px-1 mb-1 sticky top-0 bg-inset z-10 py-1.5">
        <span className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${config.dot}`} aria-hidden />
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-700">{config.title}</h3>
        </span>
        <span className="neumorphic px-3 py-1 rounded-lg text-xs font-black text-gray-800">
          {orders.length.toString().padStart(2, "0")}
        </span>
      </div>

      {orders.length === 0 && (
        <div className="h-24 flex items-center justify-center neumorphic-inset rounded-2xl p-4 text-center">
          <p className="text-xs font-bold text-gray-500">Sin pedidos</p>
        </div>
      )}

      {orders.map((order) => {
        const busy = busyId === order.id;
        const done = config.status === "Finalizados";
        return (
          <article
            key={order.id}
            className={`neumorphic p-4 rounded-2xl space-y-3 transition-transform hover:-translate-y-0.5 ${done ? "opacity-75" : ""} ${busy ? "opacity-60" : ""}`}
          >
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h4 className="font-headline font-bold text-sm text-gray-800">
                  <Link href={`/admin/pedidos/${order.id}`} className="hover:text-brand-orange transition-colors">
                    {formatOrderId(order.id)}
                  </Link>
                  <span className="font-medium text-gray-500"> · {order.client_name}</span>
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">{order.items_desc}</p>
              </div>
              <span className="text-sm font-black text-brand-orange shrink-0">{formatMoney(order.total)}</span>
            </div>

            {order.delivery_address && (
              <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
                <MapPin size={12} className="shrink-0 mt-0.5" aria-hidden />
                <span className="truncate">{order.delivery_address}</span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!done && (
                <span className={`flex items-center gap-1.5 text-[11px] font-bold w-fit px-2.5 py-1 rounded-full border ${config.chip}`}>
                  <Chip size={14} aria-hidden />
                  hace {minutesSince(order.created_at)} min
                </span>
              )}
              {order.payment_method && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-gray-500">
                  <CreditCard size={12} aria-hidden />
                  {order.payment_method}
                </span>
              )}
              {order.courier_name && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-blue-600">
                  <Bike size={12} aria-hidden />
                  {order.courier_name}
                </span>
              )}
            </div>

            {order.notes && <p className="text-[11px] text-gray-500 italic">&ldquo;{order.notes}&rdquo;</p>}

            {onAssign && couriers.length > 0 && ASSIGNABLE.includes(config.status) && (
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
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMove(order.id, config.action!.next)}
                  className={`flex-1 py-2 rounded-xl transition-all font-bold text-xs disabled:opacity-50 ${config.action.className}`}
                >
                  {config.action.label}
                </button>
                {config.cancellable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onMove(order.id, "Cancelado")}
                    aria-label={`Cancelar pedido ${formatOrderId(order.id)}`}
                    className="px-3 py-2 rounded-xl neumorphic text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
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
  );
}
