import Link from "next/link";
import { Eye } from "lucide-react";
import { createAdminClient } from "@/utils/supabase/admin";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/lib/buttonClasses";
import { cn } from "@/lib/cn";

const STATUS_TONE: Record<string, "green" | "red" | "yellow" | "blue" | "orange"> = {
  Finalizados:      "green",
  Cancelado:        "red",
  "En Preparación": "yellow",
  Recibidos:        "blue",
  "En Camino":      "orange",
};

function formatId(uuid: string) {
  return `#${uuid.slice(0, 8).toUpperCase()}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function PedidosPage() {
  const supabase = createAdminClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id, client_id, status, items_desc, total, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const pedidos = orders ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">
            Gestión de Pedidos
          </h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Historial completo de órdenes — {pedidos.length} registro{pedidos.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {pedidos.length === 0 ? (
        <div className="neumorphic rounded-2xl p-10 text-center">
          <p className="text-gray-500 text-sm font-medium">No hay pedidos aún</p>
          <p className="text-gray-400 text-xs mt-1">
            Los pedidos creados desde el tablero aparecerán aquí.
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
                      {formatId(pedido.id)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">
                      {formatDate(pedido.created_at)}
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-gray-600">
                      {pedido.client_id
                        ? pedido.client_id.slice(0, 8).toUpperCase()
                        : "Anónimo"}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 max-w-[220px] truncate">
                      {pedido.items_desc}
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-brand-orange">
                      ${Number(pedido.total).toLocaleString("es-AR")}
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
    </div>
  );
}
