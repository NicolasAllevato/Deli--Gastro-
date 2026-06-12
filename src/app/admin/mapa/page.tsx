"use client";

import dynamic from "next/dynamic";
import { MapPin, Search, SlidersHorizontal, Bike, Clock, CheckCircle } from "lucide-react";
import { mockEntregas } from "@/fixtures/orders";

const MapComponent = dynamic(() => import("./MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[300px] flex items-center justify-center rounded-2xl neumorphic-inset">
      <div className="text-gray-500 flex flex-col items-center gap-2 animate-pulse">
        <MapPin className="w-8 h-8" />
        <p className="font-bold text-sm">Cargando mapa...</p>
      </div>
    </div>
  ),
});

const estadoIcon: Record<string, React.ReactNode> = {
  "En Camino":       <Bike size={14} className="text-blue-500" />,
  "En Preparación":  <Clock size={14} className="text-yellow-500" />,
  "Entregado":       <CheckCircle size={14} className="text-green-500" />,
};

export default function MapaPage() {
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Mapa Logístico</h1>
          <p className="text-gray-500 text-xs mt-0.5 font-medium">Entregas activas en tiempo real</p>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full badge-blue text-xs font-bold">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          {mockEntregas.filter(e => e.estado === "En Camino").length} en ruta
        </span>
      </div>

      {/* Mapa */}
      <div className="neumorphic rounded-2xl p-1 overflow-hidden">
        <MapComponent />
      </div>

      {/* Barra de búsqueda y filtros — placeholder para expansión futura */}
      <div className="flex gap-3 items-center">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar dirección o pedido..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl neumorphic text-xs font-bold text-gray-600 neumorphic-hover transition-all">
          <SlidersHorizontal size={14} />
          Filtros
        </button>
      </div>

      {/* Lista de entregas activas */}
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">Entregas activas</p>
        <div className="space-y-2">
          {mockEntregas.map((entrega) => (
            <div key={entrega.id} className="neumorphic rounded-xl p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full neumorphic-inset flex items-center justify-center shrink-0">
                {estadoIcon[entrega.estado]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-gray-700">{entrega.id}</span>
                  <span className="text-[10px] font-bold text-gray-500">{entrega.cliente}</span>
                </div>
                <p className="text-[11px] text-gray-500 truncate mt-0.5">{entrega.direccion}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  entrega.estado === "En Camino" ? "badge-blue" :
                  entrega.estado === "En Preparación" ? "badge-yellow" : "badge-green"
                }`}>
                  {entrega.estado}
                </span>
                <p className="text-[10px] text-gray-500 mt-1">~{entrega.minutos} min</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
