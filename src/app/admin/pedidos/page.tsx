import Link from "next/link";
import { Search, Filter, Eye, AlertTriangle } from "lucide-react";
import { mockPedidosAdmin } from "@/fixtures/pedidos-admin";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/lib/buttonClasses";
import { cn } from "@/lib/cn";

const ESTADO_TONE = {
  Entregado:        "green",
  Cancelado:        "red",
  "En Preparación": "yellow",
} as const;

function estadoTone(estado: string): "green" | "red" | "yellow" | "blue" {
  return (ESTADO_TONE as Record<string, "green" | "red" | "yellow">)[estado] ?? "blue";
}

export default function PedidosPage() {
  const mockPedidos = mockPedidosAdmin;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Gestión de Pedidos</h1>
          <p className="text-gray-500 text-xs mt-0.5">Historial completo de órdenes y tickets asociados.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar pedido..."
              className="pl-9 pr-4 py-2.5 w-56 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
            />
          </div>
          <Button variant="icon" size="sm" aria-label="Filtrar pedidos">
            <Filter className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="neumorphic rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">ID Pedido</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Fecha</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Cliente</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Total</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Estado</th>
                <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest">Acciones</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {mockPedidos.map((pedido) => (
                <tr key={pedido.id} className="border-b border-gray-100 hover:bg-white/30 transition-colors">
                  <td className="px-5 py-4 font-bold text-sm">
                    <span className="flex items-center gap-2">
                      {pedido.id}
                      {pedido.ticket && (
                        <span title="Ticket interno asociado">
                          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500">{pedido.fecha}</td>
                  <td className="px-5 py-4 text-sm font-medium">{pedido.cliente}</td>
                  <td className="px-5 py-4 text-sm font-bold text-brand-orange">${pedido.total.toFixed(2)}</td>
                  <td className="px-5 py-4">
                    <Badge tone={estadoTone(pedido.estado)}>{pedido.estado}</Badge>
                  </td>
                  <td className="px-5 py-4">
                    <Link
                      href={`/admin/pedidos/${pedido.id}`}
                      className={cn(buttonClasses("secondary", "sm"), "gap-1.5")}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Ver Detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
