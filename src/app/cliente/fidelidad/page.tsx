import { Star, Gift, TrendingUp, Award } from "lucide-react";
import { AnimatedProgressBar } from "@/components/ui/AnimatedProgressBar";

const historialPuntos = [
  { id: "ORD-101", fecha: "2026-05-01", descripcion: "Power Bowl de Salmón + Volcán de Cacao", puntos: 83 },
  { id: "ORD-098", fecha: "2026-04-28", descripcion: "Pasta Primavera + Ensalada del Bosque", puntos: 74 },
  { id: "ORD-085", fecha: "2026-04-15", descripcion: "Hamburguesa Clásica + Papas Fritas", puntos: 68 },
  { id: "ORD-072", fecha: "2026-04-02", descripcion: "Power Bowl de Atún", puntos: 55 },
];

const recompensas = [
  { nombre: "Postre gratis", puntosRequeridos: 200, descripcion: "Cualquier postre del menú" },
  { nombre: "Bebida gratis", puntosRequeridos: 150, descripcion: "Bebida de hasta $2.000" },
  { nombre: "10% de descuento", puntosRequeridos: 100, descripcion: "En tu próximo pedido" },
];

const totalPuntos = historialPuntos.reduce((sum, h) => sum + h.puntos, 0);
const puntosParaSiguiente = 300;

export default function FidelidadPage() {
  return (
    <div className="px-6 py-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Mis Recompensas</h2>
        <p className="text-gray-500 text-sm font-medium mt-1">Acumulá puntos con cada pedido</p>
      </div>

      {/* Balance de puntos */}
      <div className="neumorphic rounded-[2rem] p-6 text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-yellow-50 neumorphic-inset flex items-center justify-center">
          <Star size={36} className="fill-yellow-400 text-yellow-400" />
        </div>
        <p className="text-5xl font-headline font-black text-gray-800">{totalPuntos}</p>
        <p className="text-gray-500 font-medium mt-1">puntos acumulados</p>

        {/* Barra de progreso */}
        <div className="mt-6">
          <div className="flex justify-between text-xs font-bold text-gray-500 mb-2">
            <span>{totalPuntos} pts</span>
            <span>{puntosParaSiguiente} pts para el próximo nivel</span>
          </div>
          <AnimatedProgressBar value={totalPuntos} max={puntosParaSiguiente} />
        </div>
      </div>

      {/* Recompensas disponibles */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Gift size={18} className="text-brand-orange" />
          <h3 className="font-headline font-black text-lg text-gray-800">Canjeá tus puntos</h3>
        </div>
        <div className="space-y-3">
          {recompensas.map((recompensa) => {
            const disponible = totalPuntos >= recompensa.puntosRequeridos;
            return (
              <div
                key={recompensa.nombre}
                className={`neumorphic rounded-[1.5rem] p-4 flex items-center justify-between gap-4 ${disponible ? "neumorphic-hover" : "opacity-60"}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center ${disponible ? "bg-yellow-50" : "bg-gray-100"}`}>
                    <Award size={18} className={disponible ? "text-yellow-500" : "text-gray-500"} />
                  </div>
                  <div>
                    <p className="font-headline font-black text-gray-800 text-sm">{recompensa.nombre}</p>
                    <p className="text-xs text-gray-500">{recompensa.descripcion}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-yellow-600">{recompensa.puntosRequeridos} pts</p>
                  {disponible && (
                    <button className="mt-1 px-3 py-1 rounded-full bg-brand-orange text-white text-xs font-black shadow-[0_4px_12px_rgba(255,123,0,0.3)] hover:scale-105 transition-transform">
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
        <div className="space-y-3">
          {historialPuntos.map((item) => (
            <div key={item.id} className="neumorphic rounded-[1.5rem] p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-sm text-gray-700 font-headline truncate">{item.descripcion}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.fecha} · {item.id}</p>
              </div>
              <span className="flex items-center gap-1 text-sm font-black text-yellow-600 shrink-0">
                <Star size={13} className="fill-yellow-400 text-yellow-400" />
                +{item.puntos}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
