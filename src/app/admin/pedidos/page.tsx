export const dynamic = "force-dynamic";

import Link from "next/link";
import { Eye } from "lucide-react";
import { createAdminClient } from "@/utils/supabase/admin";
import { listOrdersPage, type EnrichedOrder } from "@/lib/orders-server";
import { fudoOriginLabel, fudoSourceBadge } from "@/lib/fudo/origin";
import { formatMoney, formatOrderId } from "@/lib/orders";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/lib/buttonClasses";
import { cn } from "@/lib/cn";
import type { OrderStatus } from "@/types/database";
import { formatDateTimeAR } from "@/lib/time-ar";

const STATUS_TONE: Record<string, "green" | "red" | "yellow" | "blue" | "orange"> = {
  Finalizados:      "green",
  Cancelado:        "red",
  "En Preparación": "yellow",
  Recibidos:        "blue",
  "En Camino":      "orange",
};

const FILTERS: ReadonlyArray<{ label: string; value: OrderStatus | "todos" }> = [
  { label: "Todos", value: "todos" },
  { label: "Recibidos", value: "Recibidos" },
  { label: "En preparación", value: "En Preparación" },
  { label: "En camino", value: "En Camino" },
  { label: "Finalizados", value: "Finalizados" },
  { label: "Cancelados", value: "Cancelado" },
];

function formatDateTime(iso: string) {
  return formatDateTimeAR(iso, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAGE_SIZE = 50;

const CHANNEL_LABEL: Record<string, string> = { web: "Web", whatsapp: "WhatsApp", mostrador: "Mostrador" };

/** Etiqueta del canal: PedidosYa/Rappi/Morfy/Fudo (con tipo de venta) o el canal propio de la app. */
function ChannelTag({ order }: { order: EnrichedOrder }) {
  const fudo = fudoOriginLabel(order);
  const label = fudo ?? CHANNEL_LABEL[order.channel] ?? order.channel;
  const cls = fudo ? fudoSourceBadge(order.fudo_source) : "badge-green";
  return (
    <span className={cn(cls, "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap")} title={order.fudo_payment ?? undefined}>
      {label}
    </span>
  );
}

function pageHref(filter: string, page: number): string {
  const params = new URLSearchParams();
  if (filter !== "todos") params.set("estado", filter);
  if (page > 1) params.set("pagina", String(page));
  const q = params.toString();
  return q ? `/admin/pedidos?${q}` : "/admin/pedidos";
}

export default async function PedidosPage({ searchParams }: { searchParams: Promise<{ estado?: string; pagina?: string }> }) {
  const { estado, pagina } = await searchParams;
  const filter = FILTERS.find((f) => f.value === estado)?.value ?? "todos";
  const page = Math.max(1, Number.parseInt(pagina ?? "1", 10) || 1);

  const { orders: pedidos, total } = await listOrdersPage(createAdminClient(), {
    status: filter === "todos" ? undefined : filter,
    page,
    pageSize: PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">
            Gestión de Pedidos
          </h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Historial completo de órdenes — {total} registro{total !== 1 ? "s" : ""}
            {pages > 1 ? ` · página ${page} de ${pages}` : ""}
          </p>
        </div>
      </div>

      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={pageHref(f.value, 1)}
            aria-current={filter === f.value ? "page" : undefined}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold transition-all",
              filter === f.value
                ? "bg-brand-orange text-white shadow-[0_3px_8px_rgba(124,58,237,0.3)]"
                : "neumorphic text-gray-600 neumorphic-hover",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {pedidos.length === 0 ? (
        <div className="neumorphic rounded-2xl p-10 text-center">
          <p className="text-gray-500 text-sm font-medium">No hay pedidos para mostrar</p>
          <p className="text-gray-400 text-xs mt-1">
            Los pedidos de los clientes y los creados desde el tablero aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="neumorphic rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">ID Pedido</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Fecha</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Canal</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Cliente</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Items</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Total</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Estado</th>
                  <th scope="col" className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {pedidos.map((pedido) => (
                  <tr
                    key={pedido.id}
                    className="border-b border-gray-100 hover:bg-white/30 transition-colors"
                  >
                    <td className="px-5 py-4 font-bold text-sm font-mono text-gray-700">
                      {formatOrderId(pedido.id)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {formatDateTime(pedido.created_at)}
                    </td>
                    <td className="px-5 py-4">
                      <ChannelTag order={pedido} />
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-gray-600">
                      {pedido.client_name}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 max-w-[260px] truncate">
                      {pedido.items_desc}
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-brand-orange">
                      {formatMoney(pedido.total)}
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={STATUS_TONE[pedido.status] ?? "blue"}>
                        {pedido.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/pedidos/${pedido.id}`}
                        className={cn(buttonClasses("secondary", "sm"), "gap-1.5")}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Páginas del historial" className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Link href={pageHref(filter, page - 1)} className={buttonClasses("secondary", "sm")}>
              Anterior
            </Link>
          ) : null}
          <span className="text-xs font-bold text-gray-500">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(filter, page + 1)} className={buttonClasses("secondary", "sm")}>
              Siguiente
            </Link>
          ) : null}
        </nav>
      )}
    </div>
  );
}
