export const dynamic = 'force-dynamic';

import Link from "next/link";
import { Clock, CheckCircle, XCircle, ChevronRight, ShoppingBag, ArrowRight, Sparkles } from "lucide-react";
import { requireClientPage } from "@/lib/auth/clientPage";
import { formatOrderId, pointsForTotal } from "@/lib/orders";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { clientEarnedByOrder, clientOrders, clientReviewedOrderIds, orFallback } from "@/lib/client-reads";

const ESTADO_CONFIG: Record<string, { icon: React.ReactNode; classes: string }> = {
  Finalizados:      { icon: <CheckCircle size={12} />, classes: "badge-green" },
  Cancelado:        { icon: <XCircle size={12} />,    classes: "badge-red" },
  "En Preparación": { icon: <Clock size={12} />,      classes: "badge-blue" },
  Recibidos:        { icon: <Clock size={12} />,      classes: "badge-yellow" },
  "En Camino":      { icon: <Clock size={12} />,      classes: "badge-orange" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Puntos del pedido: los sumados si ya se acreditaron; los que va a sumar si sigue en curso. */
function OrderPoints({ status, earned, upcoming }: { status: string; earned?: number; upcoming: number }) {
  if (status === "Cancelado") return null;
  if (earned) {
    return (
      <p className="inline-flex items-center gap-1.5 self-start rounded-full badge-orange px-2.5 py-1 text-[11px] font-bold">
        <Sparkles size={12} aria-hidden /> Sumaste {earned.toLocaleString("es-AR")} puntos
      </p>
    );
  }
  if (status === "Finalizados" || upcoming <= 0) return null;
  return (
    <p className="inline-flex items-center gap-1.5 self-start text-[11px] font-bold text-gray-500">
      <Sparkles size={12} aria-hidden /> Vas a sumar {upcoming.toLocaleString("es-AR")} puntos al recibirlo
    </p>
  );
}

export default async function ClientePedidosPage() {
  const { user, client, db } = await requireClientPage();
  const ctx = client ? { db, userId: user.id, clientId: client.id } : null;

  // Pedidos, reseñados y puntos acreditados por pedido (con sombra D1 si DATA_BACKEND=dual).
  const [pedidos, reviewed, earned] = ctx
    ? await Promise.all([
        // Igual que antes: si una consulta falla, la página muestra vacío en vez de romperse.
        orFallback(clientOrders(ctx), []),
        orFallback(clientReviewedOrderIds(ctx), new Set<string>()),
        orFallback(clientEarnedByOrder(ctx), new Map<string, number>()),
      ])
    : [[], new Set<string>(), new Map<string, number>()];
  const puntosPor100 = numberConfig(await readConfig(db), "puntos_por_100", 0.5);

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto pb-8">

      <div className="mb-6 fade-up">
        <h2 className="font-headline text-2xl font-black text-gray-800">Mis Pedidos</h2>
        <p className="text-gray-500 text-sm mt-0.5">Historial de tus órdenes</p>
      </div>

      {pedidos.length > 0 ? (
        <div className="space-y-3">
          {pedidos.map((pedido, i) => {
            const cfg = ESTADO_CONFIG[pedido.status] ?? ESTADO_CONFIG["En Preparación"];
            return (
              <div
                key={pedido.id}
                className={`neumorphic rounded-2xl p-4 flex flex-col gap-3 card-hover-lift fade-up-${Math.min(i + 1, 4)}`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-bold text-sm text-gray-800">{formatOrderId(pedido.id)}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(pedido.created_at)}</p>
                  </div>
                  <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0 ${cfg.classes}`}>
                    {cfg.icon}{pedido.status}
                  </span>
                </div>

                <p className="text-xs text-gray-500 truncate">{pedido.items_desc}</p>

                <OrderPoints
                  status={pedido.status}
                  earned={earned.get(pedido.id)}
                  upcoming={pedido.points_earned ?? pointsForTotal(Number(pedido.total), puntosPor100)}
                />

                <div className="flex items-center justify-between pt-3 border-t border-gray-200/50">
                  <span className="font-headline font-black text-brand-orange text-base">
                    ${Number(pedido.total).toLocaleString("es-AR")}
                  </span>
                  <div className="flex items-center gap-4">
                    {pedido.status === "Finalizados" && !reviewed.has(pedido.id) && (
                      <Link
                        href={`/cliente/resenas/${pedido.id}`}
                        className="flex items-center gap-0.5 text-[11px] font-black text-brand-orange hover:text-[#6d28d9] transition-colors"
                      >
                        Reseñar <ChevronRight size={13} />
                      </Link>
                    )}
                    <Link
                      href={`/cliente/pedidos/${pedido.id}`}
                      className="flex items-center gap-0.5 text-[11px] font-black text-gray-500 hover:text-brand-orange transition-colors"
                    >
                      {pedido.status === "Finalizados" || pedido.status === "Cancelado" ? "Ver detalle" : "Seguir pedido"} <ChevronRight size={13} />
                    </Link>
                  </div>
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
          <Link
            href="/cliente"
            className="inline-flex items-center gap-1.5 mt-5 px-6 py-2.5 rounded-full bg-brand-orange text-white font-bold text-sm btn-glow"
          >
            Ver Menú <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}
