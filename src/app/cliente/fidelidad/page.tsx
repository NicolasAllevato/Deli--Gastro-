import { Star, Gift, TrendingUp, Award } from "lucide-react";
import { AnimatedProgressBar } from "@/components/ui/AnimatedProgressBar";
import { createAdminClient } from "@/utils/supabase/admin";

const RECOMPENSAS = [
  { nombre: "Postre gratis",    puntosRequeridos: 200, descripcion: "Cualquier postre del menú" },
  { nombre: "Bebida gratis",    puntosRequeridos: 150, descripcion: "Bebida de hasta $2.000" },
  { nombre: "10% de descuento", puntosRequeridos: 100, descripcion: "En tu próximo pedido" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function FidelidadPage() {
  const supabase = createAdminClient();

  const [{ data: clients }, { data: ledger }] = await Promise.all([
    supabase
      .from("clients")
      .select("total_points, tier")
      .order("total_points", { ascending: false })
      .limit(1),
    supabase
      .from("points_ledger")
      .select("id, delta, description, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const totalPuntos = clients?.[0]?.total_points ?? 0;
  const puntosParaSiguiente = 300;
  const historial = ledger ?? [];

  return (
    <div className="px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <div>
        <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Mis Recompensas</h2>
        <p className="text-gray-500 text-sm font-medium mt-1">Acumulá puntos con cada pedido</p>
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
            <span className="text-right">{puntosParaSiguiente} pts para el próximo nivel</span>
          </div>
          <AnimatedProgressBar value={totalPuntos} max={puntosParaSiguiente} label="Progreso hacia el próximo nivel" />
        </div>
      </div>

      {/* Recompensas disponibles */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Gift size={18} className="text-brand-orange" />
          <h3 className="font-headline font-black text-lg text-gray-800">Canjeá tus puntos</h3>
        </div>
        <div className="space-y-3">
          {RECOMPENSAS.map((recompensa) => {
            const disponible = totalPuntos >= recompensa.puntosRequeridos;
            return (
              <div
                key={recompensa.nombre}
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
                  {disponible && (
                    <button
                      type="button"
                      aria-label={`Canjear: ${recompensa.nombre}`}
                      className="px-3 py-1 rounded-full bg-brand-orange text-white text-xs font-black shadow-[0_4px_12px_rgba(107,124,69,0.3)] hover:scale-105 transition-transform"
                    >
                      Canjear
                    </button>
                  )}
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
                <span className="flex items-center gap-1 text-sm font-black text-yellow-600 shrink-0">
                  <Star size={13} className="fill-yellow-400 text-yellow-400" />
                  +{item.delta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
