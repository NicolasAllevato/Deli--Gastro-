import Link from "next/link";
import { Star, Clock, CheckCircle, XCircle, ChevronRight, ShoppingBag, ArrowRight } from "lucide-react";

const mockPedidos = [
  { id: "ORD-101", fecha: "01/05/2026", items: ["Power Bowl de Salmón", "Volcán de Cacao"], total: 16630, estado: "Entregado",      puntos: 83, orderId: "101" },
  { id: "ORD-098", fecha: "28/04/2026", items: ["Pasta Primavera", "Ensalada del Bosque"],  total: 14790, estado: "Entregado",      puntos: 74, orderId: "098" },
  { id: "ORD-089", fecha: "20/04/2026", items: ["Hamburguesa Clásica"],                     total: 13500, estado: "Cancelado",     puntos: 0,  orderId: "089" },
  { id: "ORD-075", fecha: "10/04/2026", items: ["Ensalada del Bosque", "Volcán de Cacao"],  total: 10470, estado: "En Preparación", puntos: 0,  orderId: "075" },
];

const estadoConfig: Record<string, { icon: React.ReactNode; classes: string }> = {
  Entregado:        { icon: <CheckCircle size={12} />, classes: "badge-green" },
  Cancelado:        { icon: <XCircle size={12} />,    classes: "badge-red" },
  "En Preparación": { icon: <Clock size={12} />,      classes: "badge-blue" },
};

export default function ClientePedidosPage() {
  return (
    <div className="px-5 py-6 max-w-2xl mx-auto pb-8">

      <div className="mb-6 fade-up">
        <h2 className="font-headline text-2xl font-black text-gray-800">Mis Pedidos</h2>
        <p className="text-gray-500 text-sm mt-0.5">Historial de tus órdenes</p>
      </div>

      {mockPedidos.length > 0 ? (
        <div className="space-y-3">
          {mockPedidos.map((pedido, i) => {
            const cfg = estadoConfig[pedido.estado] ?? estadoConfig["En Preparación"];
            return (
              <div
                key={pedido.id}
                className={`neumorphic rounded-2xl p-4 flex flex-col gap-3 card-hover-lift fade-up-${Math.min(i + 1, 4)}`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-bold text-sm text-gray-800">{pedido.id}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{pedido.fecha}</p>
                  </div>
                  <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0 ${cfg.classes}`}>
                    {cfg.icon}{pedido.estado}
                  </span>
                </div>

                <p className="text-xs text-gray-500 truncate">{pedido.items.join(", ")}</p>

                <div className="flex items-center justify-between pt-3 border-t border-gray-200/50">
                  <div className="flex items-center gap-2">
                    <span className="font-headline font-black text-brand-orange text-base">
                      ${pedido.total.toLocaleString("es-AR")}
                    </span>
                    {pedido.puntos > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] font-bold badge-yellow px-2 py-0.5 rounded-full">
                        <Star size={10} className="fill-yellow-400 text-yellow-400" />
                        +{pedido.puntos} pts
                      </span>
                    )}
                  </div>
                  {pedido.estado === "Entregado" && (
                    <Link
                      href={`/cliente/resenas/${pedido.orderId}`}
                      className="flex items-center gap-0.5 text-[11px] font-black text-brand-orange hover:text-orange-600 transition-colors"
                    >
                      Reseñar <ChevronRight size={13} />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="neumorphic-inset rounded-2xl p-10 text-center fade-up">
          <div className="w-12 h-12 rounded-full neumorphic flex items-center justify-center mx-auto mb-4 text-gray-300">
            <ShoppingBag size={22} />
          </div>
          <p className="font-bold text-gray-500 text-sm">No tenés pedidos aún</p>
          <p className="text-gray-500 text-xs mt-1">¡Explorá el menú y hacé tu primer pedido!</p>
          <Link href="/cliente" className="inline-flex items-center gap-1.5 mt-5 px-6 py-2.5 rounded-full bg-brand-orange text-white font-bold text-sm btn-glow">
            Ver Menú <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}
