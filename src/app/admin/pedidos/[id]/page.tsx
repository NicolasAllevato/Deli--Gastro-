import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, User, MapPin, Receipt, AlertTriangle, Phone } from "lucide-react";
import { mockPedidosDetalle } from "@/fixtures/pedidos-admin";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/lib/buttonClasses";

const ESTADO_TONE = {
  Entregado:        "green",
  Cancelado:        "red",
  "En Preparación": "yellow",
} as const;

function estadoTone(estado: string): "green" | "red" | "yellow" | "blue" {
  return (ESTADO_TONE as Record<string, "green" | "red" | "yellow">)[estado] ?? "blue";
}

export default async function PedidoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedido = mockPedidosDetalle.find((p) => p.id === id);

  if (!pedido) notFound();

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">

      {/* Cabecera */}
      <div className="flex items-center gap-4">
        <Link
          href="/admin/pedidos"
          aria-label="Volver a pedidos"
          className={buttonClasses("icon", "sm")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Pedido {pedido.id}</h1>
          <p className="text-gray-500 text-xs mt-0.5">{pedido.fecha}</p>
        </div>
        <div className="ml-auto">
          <Badge tone={estadoTone(pedido.estado)}>{pedido.estado}</Badge>
        </div>
      </div>

      {/* Ticket interno */}
      {pedido.ticket && pedido.notasTicket && (
        <div className="neumorphic p-5 rounded-2xl border-l-4 border-orange-400 flex gap-4 items-start bg-orange-50/50">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-orange-800 text-sm">Ticket de Atención Interna</h3>
            <p className="text-orange-700 mt-1 text-sm">{pedido.notasTicket}</p>
          </div>
        </div>
      )}

      {/* Cards de info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Cliente */}
        <div className="neumorphic p-5 rounded-2xl">
          <div className="flex items-center gap-2 mb-4 text-gray-700">
            <User className="w-4 h-4" />
            <h2 className="font-headline font-bold text-sm uppercase tracking-widest">Cliente</h2>
          </div>
          <div className="space-y-3 text-sm text-gray-600">
            <p><span className="font-bold text-gray-700">Nombre:</span> {pedido.clienteDetalle.nombre}</p>
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <span>{pedido.clienteDetalle.telefono}</span>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <span>{pedido.clienteDetalle.direccion}</span>
            </div>
          </div>
        </div>

        {/* Detalle de items */}
        <div className="neumorphic p-5 rounded-2xl">
          <div className="flex items-center gap-2 mb-4 text-gray-700">
            <Receipt className="w-4 h-4" />
            <h2 className="font-headline font-bold text-sm uppercase tracking-widest">Detalle</h2>
          </div>
          <ul className="space-y-2.5 mb-5">
            {pedido.items.map((item) => (
              <li key={item.id} className="flex justify-between text-sm text-gray-600">
                <span>{item.cant}x {item.nombre}</span>
                <span className="font-bold">${item.precio.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="pt-3.5 border-t border-gray-200 flex justify-between items-center">
            <span className="font-bold text-sm text-gray-800">Total</span>
            <span className="font-black text-base text-brand-orange">${pedido.total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
