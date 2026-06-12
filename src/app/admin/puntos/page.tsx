"use client";

import { useState } from "react";
import { Star, ChevronDown, ChevronUp, Bell, Gift, TrendingUp, Users, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface PedidoPuntos {
  id: string;
  fecha: string;
  items: string;
  total: number;
  puntos: number;
}

interface Cliente {
  id: string;
  nombre: string;
  email: string;
  puntosTotales: number;
  nivel: "Bronce" | "Plata" | "Oro" | "Platino";
  pedidos: PedidoPuntos[];
}

interface Promocion {
  id: string;
  nombre: string;
  descripcion: string;
  puntosRequeridos: number;
  activa: boolean;
}

const nivelConfig: Record<string, { color: string; badge: string }> = {
  Bronce:  { color: "text-amber-700",  badge: "bg-amber-50 text-amber-700 border-amber-200" },
  Plata:   { color: "text-slate-500",  badge: "bg-slate-100 text-slate-600 border-slate-300" },
  Oro:     { color: "text-yellow-600", badge: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  Platino: { color: "text-brand-orange", badge: "badge-orange" },
};

const mockClientes: Cliente[] = [
  {
    id: "c1", nombre: "María López", email: "maria.lopez@email.com",
    puntosTotales: 280, nivel: "Oro",
    pedidos: [
      { id: "ORD-101", fecha: "01/05/2026", items: "Power Bowl de Salmón + Volcán de Cacao", total: 16630, puntos: 83 },
      { id: "ORD-098", fecha: "28/04/2026", items: "Pasta Primavera + Ensalada del Bosque", total: 14790, puntos: 74 },
      { id: "ORD-085", fecha: "15/04/2026", items: "Hamburguesa Clásica + Papas Fritas", total: 13600, puntos: 68 },
      { id: "ORD-072", fecha: "02/04/2026", items: "Power Bowl de Atún", total: 11000, puntos: 55 },
    ],
  },
  {
    id: "c2", nombre: "Juan Pérez", email: "juan.perez@email.com",
    puntosTotales: 145, nivel: "Plata",
    pedidos: [
      { id: "ORD-100", fecha: "30/04/2026", items: "Ensalada del Bosque", total: 6290, puntos: 31 },
      { id: "ORD-091", fecha: "22/04/2026", items: "Hamburguesa Clásica", total: 8500, puntos: 42 },
      { id: "ORD-080", fecha: "08/04/2026", items: "Pasta Primavera", total: 8500, puntos: 42 },
      { id: "ORD-069", fecha: "25/03/2026", items: "Power Bowl de Salmón", total: 6000, puntos: 30 },
    ],
  },
  {
    id: "c3", nombre: "Carlos Ruiz", email: "carlos.ruiz@email.com",
    puntosTotales: 62, nivel: "Bronce",
    pedidos: [
      { id: "ORD-099", fecha: "29/04/2026", items: "Volcán de Cacao", total: 4180, puntos: 20 },
      { id: "ORD-088", fecha: "19/04/2026", items: "Ensalada del Bosque + Bebida", total: 8500, puntos: 42 },
    ],
  },
  {
    id: "c4", nombre: "Ana Gómez", email: "ana.gomez@email.com",
    puntosTotales: 520, nivel: "Platino",
    pedidos: [
      { id: "ORD-103", fecha: "02/05/2026", items: "Power Bowl de Salmón + Volcán + Bebida", total: 20000, puntos: 100 },
      { id: "ORD-095", fecha: "25/04/2026", items: "Pasta Primavera + Ensalada del Bosque", total: 14790, puntos: 74 },
      { id: "ORD-082", fecha: "12/04/2026", items: "Hamburguesa Clásica + Papas + Bebida", total: 14800, puntos: 74 },
      { id: "ORD-071", fecha: "01/04/2026", items: "Power Bowl de Atún + Volcán de Cacao", total: 15180, puntos: 75 },
      { id: "ORD-060", fecha: "20/03/2026", items: "Ensalada del Bosque + Bebida", total: 9400, puntos: 47 },
      { id: "ORD-051", fecha: "10/03/2026", items: "Pasta Primavera", total: 8500, puntos: 42 },
    ],
  },
];

const promocionesDisponibles: Promocion[] = [
  { id: "p1", nombre: "Postre Gratis",    descripcion: "Cualquier postre del menú sin cargo",      puntosRequeridos: 200, activa: true },
  { id: "p2", nombre: "10% Descuento",    descripcion: "Descuento en el próximo pedido",             puntosRequeridos: 100, activa: true },
  { id: "p3", nombre: "Bebida Gratis",    descripcion: "Bebida de hasta $2.500",                     puntosRequeridos: 150, activa: true },
  { id: "p4", nombre: "Envío Gratis",     descripcion: "Sin costo de envío en el próximo pedido",    puntosRequeridos: 80,  activa: true },
  { id: "p5", nombre: "Menú Completo",    descripcion: "Plato + bebida + postre sin cargo",          puntosRequeridos: 500, activa: false },
];

function getPromosDisponibles(puntos: number) {
  return promocionesDisponibles.filter(p => p.activa && puntos >= p.puntosRequeridos);
}

export default function AdminPuntosPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notifCliente, setNotifCliente] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const clientesFiltrados = mockClientes.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalPuntosEmitidos = mockClientes.reduce((s, c) => s + c.puntosTotales, 0);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Programa de Puntos</h1>
          <p className="text-gray-500 text-xs mt-0.5">Puntos acumulados por cliente y promociones disponibles</p>
        </div>
        <Button leftIcon={<Bell size={14} />} size="sm">
          Notificar a todos
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Clientes activos", value: mockClientes.length, icon: <Users size={16} className="text-brand-orange" /> },
          { label: "Puntos emitidos", value: totalPuntosEmitidos.toLocaleString("es-AR"), icon: <Star size={16} className="text-yellow-500" /> },
          { label: "Promos activas", value: promocionesDisponibles.filter(p => p.activa).length, icon: <Gift size={16} className="text-green-500" /> },
          { label: "Nivel Platino", value: mockClientes.filter(c => c.nivel === "Platino").length, icon: <TrendingUp size={16} className="text-brand-orange" /> },
        ].map(kpi => (
          <div key={kpi.label} className="neumorphic rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full neumorphic-inset flex items-center justify-center shrink-0">
              {kpi.icon}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate">{kpi.label}</p>
              <p className="font-headline font-black text-base text-gray-800">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente por nombre o email..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
        />
      </div>

      {/* Lista de clientes */}
      <div className="space-y-2">
        {clientesFiltrados.map(cliente => {
          const isOpen = expandedId === cliente.id;
          const promos = getPromosDisponibles(cliente.puntosTotales);
          const cfg = nivelConfig[cliente.nivel];

          return (
            <div key={cliente.id} className="neumorphic rounded-2xl overflow-hidden">

              {/* Fila resumen */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/30 transition-colors text-left"
                onClick={() => setExpandedId(isOpen ? null : cliente.id)}
              >
                <div className="w-9 h-9 rounded-full neumorphic-inset flex items-center justify-center text-xs font-black text-brand-orange shrink-0">
                  {cliente.nombre.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm text-gray-800 truncate">{cliente.nombre}</p>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${cfg.badge}`}>
                      {cliente.nivel}
                    </span>
                    {promos.length > 0 && (
                      <Badge tone="green">
                        {promos.length} promo{promos.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{cliente.email}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Star size={12} className="fill-yellow-400 text-yellow-400" />
                      <span className="font-headline font-black text-sm text-gray-800">
                        {cliente.puntosTotales.toLocaleString("es-AR")}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500">{cliente.pedidos.length} pedidos</p>
                  </div>
                  {isOpen ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                </div>
              </button>

              {/* Panel expandido */}
              {isOpen && (
                <div className="border-t border-gray-200/60 px-4 pb-4 pt-3 space-y-4 animate-in fade-in duration-150">

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Detalle de puntos por pedido */}
                    <div>
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Puntos por pedido</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {cliente.pedidos.map(p => (
                          <div key={p.id} className="neumorphic-inset rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-gray-700">{p.id}</p>
                              <p className="text-[10px] text-gray-500 truncate">{p.items}</p>
                              <p className="text-[10px] text-gray-500">{p.fecha} · ${p.total.toLocaleString("es-AR")}</p>
                            </div>
                            <span className="flex items-center gap-1 text-xs font-black text-yellow-600 shrink-0">
                              <Star size={11} className="fill-yellow-400 text-yellow-400" />
                              +{p.puntos}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Promociones disponibles */}
                    <div>
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Promociones disponibles</p>
                      {promos.length === 0 ? (
                        <div className="neumorphic-inset rounded-xl px-3 py-4 text-center">
                          <p className="text-xs text-gray-500">No hay promos disponibles aún</p>
                          <p className="text-[10px] text-gray-500 mt-1">
                            Necesita {(() => {
                              const minPts = promocionesDisponibles
                                .filter(p => p.activa)
                                .reduce((min, p) => Math.min(min, p.puntosRequeridos), Infinity);
                              return minPts === Infinity ? 0 : minPts - cliente.puntosTotales;
                            })()} pts más
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {promos.map(promo => (
                            <div key={promo.id} className="neumorphic-inset rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-700">{promo.nombre}</p>
                                <p className="text-[10px] text-gray-500">{promo.descripcion}</p>
                              </div>
                              <Badge tone="yellow" className="shrink-0">
                                {promo.puntosRequeridos} pts
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Acciones */}
                      <div className="flex gap-2 mt-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          fullWidth
                          leftIcon={<Bell size={13} />}
                          onClick={() => setNotifCliente(notifCliente === cliente.id ? null : cliente.id)}
                        >
                          Notificar
                        </Button>
                        <Button
                          size="sm"
                          fullWidth
                          leftIcon={<Gift size={13} />}
                        >
                          Enviar promo
                        </Button>
                      </div>

                      {/* Panel de notificación inline */}
                      {notifCliente === cliente.id && (
                        <div className="mt-3 neumorphic-inset rounded-xl p-3 space-y-2 animate-in fade-in duration-150">
                          <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Mensaje de notificación</p>
                          <textarea
                            rows={2}
                            placeholder="Ej: ¡Tus puntos están por vencer! Usálos antes del viernes."
                            className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all resize-none"
                          />
                          <Button fullWidth size="sm">
                            Enviar notificación
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
