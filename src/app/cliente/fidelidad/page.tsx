export const dynamic = "force-dynamic";

import { Star, Gift, TrendingUp, Award } from "lucide-react";
import { AnimatedProgressBar } from "@/components/ui/AnimatedProgressBar";
import { requireClientPage } from "@/lib/auth/clientPage";
import { REWARDS } from "@/lib/orders";
import { RedeemButton } from "./RedeemButton";
import { clientLedger, orFallback } from "@/lib/client-reads";
import { formatDateAR } from "@/lib/time-ar";

function formatDate(iso: string) {
  return formatDateAR(iso, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function FidelidadPage() {
  const { user, client, db } = await requireClientPage();

  const ledger = client ? await orFallback(clientLedger({ db, userId: user.id, clientId: client.id }, 10), []) : [];

  const totalPuntos = client?.total_points ?? 0;
  const nextReward = [...REWARDS]
    .filter((r) => r.puntosRequeridos > totalPuntos)
    .sort((a, b) => a.puntosRequeridos - b.puntosRequeridos)[0];
  const puntosParaSiguiente = nextReward?.puntosRequeridos ?? Math.max(...REWARDS.map((r) => r.puntosRequeridos));
  const historial = ledger ?? [];

  return (
    <div className="px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div>
        <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Mis Recompensas</h2>
        <p className="text-gray-500 text-sm font-medium mt-1">
          Nivel {client?.tier ?? "Bronce"} · Acumulá puntos con cada pedido
        </p>
      </div>

      {/* Balance de puntos */}
      <div className="neumorphic rounded-[2rem] p-6 text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-yellow-50 neumorphic-inset flex items-center justify-center">
          <Star size={36} className="fill-yellow-400 text-yellow-400" />
        </div>
        <p className="text-4xl sm:text-5xl font-headline font-black text-gray-800">{totalPuntos}</p>
        <p className="text-gray-500 font-medium mt-1">puntos acumulados</p>

        <div className="mt-6">
          <div className="flex flex-wrap justify-between gap-1 text-xs font-bold text-gray-500 mb-2">
            <span>{totalPuntos} pts</span>
            <span className="text-right">
              {nextReward ? `${puntosParaSiguiente} pts para "${nextReward.nombre}"` : "¡Alcanzaste todas las recompensas!"}
            </span>
          </div>
          <AnimatedProgressBar value={totalPuntos} max={puntosParaSiguiente} label="Progreso hacia la próxima recompensa" />
        </div>
      </div>

      {/* Recompensas disponibles */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Gift size={18} className="text-brand-orange" />
          <h3 className="font-headline font-black text-lg text-gray-800">Canjeá tus puntos</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Elegí una recompensa y se aplica en tu carrito. Los puntos se descuentan recién al confirmar el pedido,
          y si lo cancelás, te los devolvemos.
        </p>
        <div className="space-y-3 stagger">
          {REWARDS.map((recompensa) => {
            const disponible = totalPuntos >= recompensa.puntosRequeridos;
            return (
              <div
                key={recompensa.id}
                className={`neumorphic rounded-[1.5rem] p-4 flex items-center gap-3 ${disponible ? "neumorphic-hover" : "opacity-60"}`}
              >
                <div className={`w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center shrink-0 ${disponible ? "bg-yellow-50" : "bg-gray-100"}`}>
                  <Award size={18} className={disponible ? "text-yellow-500" : "text-gray-500"} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-headline font-black text-gray-800 text-sm truncate">{recompensa.nombre}</p>
                  <p className="text-xs text-gray-500 truncate">{recompensa.descripcion}</p>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  <p className="text-xs font-bold text-yellow-600">{recompensa.puntosRequeridos} pts</p>
                  {disponible && <RedeemButton rewardId={recompensa.id} rewardName={recompensa.nombre} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historial */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-brand-orange" />
          <h3 className="font-headline font-black text-lg text-gray-800">Historial de puntos</h3>
        </div>
        {historial.length === 0 ? (
          <div className="neumorphic rounded-[1.5rem] p-6 text-center">
            <p className="text-gray-500 text-sm">No hay movimientos aún</p>
          </div>
        ) : (
          <div className="space-y-3">
            {historial.map((item) => (
              <div key={item.id} className="neumorphic rounded-[1.5rem] p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-700 font-headline truncate">{item.description}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatDate(item.created_at)}</p>
                </div>
                <span className={`flex items-center gap-1 text-sm font-black shrink-0 ${item.delta < 0 ? "text-red-500" : "text-yellow-600"}`}>
                  <Star size={13} className={item.delta < 0 ? "text-red-400" : "fill-yellow-400 text-yellow-400"} />
                  {item.delta > 0 ? `+${item.delta}` : item.delta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
