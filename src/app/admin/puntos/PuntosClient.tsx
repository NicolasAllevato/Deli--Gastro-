"use client";

import { useState } from "react";
import { Star, ChevronDown, ChevronUp, Bell, Gift, TrendingUp, Users, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/orders";
import type { ClientTier } from "@/types/database";

export interface PedidoPuntos {
  id: string;
  fecha: string;
  items: string;
  puntos: number;
}

export interface ClientePuntos {
  id: string;
  nombre: string;
  telefono: string | null;
  /** Canal de venta del cliente: app, local, pedidosya, rappi o morfy. */
  canal: string | null;
  /** Pedidos no cancelados vinculados al cliente (app y Fudo). */
  pedidosTotales: number;
  gastado: number;
  ultimoPedido: string | null;
  puntosTotales: number;
  nivel: ClientTier;
  pedidos: PedidoPuntos[];
}

const NIVEL_TONE: Record<string, "yellow" | "blue" | "orange" | "green"> = {
  Bronce:  "yellow",
  Plata:   "blue",
  Oro:     "orange",
  Platino: "orange",
};

const PAGE_SIZE = 50;

const CANAL_LABEL: Record<string, string> = { app: "App", local: "Fudo · Local", pedidosya: "PedidosYa", rappi: "Rappi", morfy: "Morfy" };

const PROMOS = [
  { id: "p1", nombre: "Postre Gratis",  descripcion: "Cualquier postre del menú sin cargo",   puntosRequeridos: 200, activa: true },
  { id: "p2", nombre: "10% Descuento",  descripcion: "Descuento en el próximo pedido",          puntosRequeridos: 100, activa: true },
  { id: "p3", nombre: "Bebida Gratis",  descripcion: "Bebida de hasta $2.500",                  puntosRequeridos: 150, activa: true },
  { id: "p4", nombre: "Envío Gratis",   descripcion: "Sin costo de envío en el próximo pedido", puntosRequeridos: 80,  activa: true },
  { id: "p5", nombre: "Menú Completo",  descripcion: "Plato + bebida + postre sin cargo",       puntosRequeridos: 500, activa: false },
];

function getPromos(puntos: number) {
  return PROMOS.filter(p => p.activa && puntos >= p.puntosRequeridos);
}

export default function PuntosClient({ clientes }: { clientes: ClientePuntos[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notifCliente, setNotifCliente] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Las notificaciones todavía no salen por n8n/WhatsApp: se simula el envío.
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const term = search.toLowerCase().trim();
  const filtrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(term) || (c.telefono ?? "").includes(term)
  );
  const mostrados = filtrados.slice(0, visible);

  const totalPuntos = clientes.reduce((s, c) => s + c.puntosTotales, 0);

  return (
    <div className="space-y-5">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">
            Programa de Puntos
          </h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Puntos acumulados por cliente y promociones disponibles
          </p>
        </div>
        <Button
          leftIcon={<Bell size={14} />}
          size="sm"
          onClick={() => announce(`Notificación enviada a ${clientes.length} clientes (simulado).`)}
        >
          Notificar a todos
        </Button>
      </div>

      {notice && (
        <p role="status" className="text-xs font-bold text-green-700 px-3 py-2 rounded-lg bg-green-50 border border-green-100">
          {notice}
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Clientes",  value: clientes.length.toLocaleString("es-AR"),                                        icon: <Users size={16} className="text-brand-orange" /> },
          { label: "Con puntos",       value: clientes.filter(c => c.puntosTotales > 0).length,      icon: <Users size={16} className="text-green-500" /> },
          { label: "Puntos emitidos",   value: totalPuntos.toLocaleString("es-AR"),                    icon: <Star size={16} className="text-yellow-500" /> },
          { label: "Promos activas",    value: PROMOS.filter(p => p.activa).length,                    icon: <Gift size={16} className="text-green-500" /> },
          { label: "Nivel Platino",     value: clientes.filter(c => c.nivel === "Platino").length,     icon: <TrendingUp size={16} className="text-brand-orange" /> },
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
          onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
          placeholder="Buscar cliente por nombre o teléfono..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
        />
      </div>

      {/* Lista de clientes */}
      {filtrados.length === 0 ? (
        <div className="neumorphic rounded-2xl p-10 text-center">
          <p className="text-gray-500 text-sm">
            {clientes.length === 0
              ? "No hay clientes registrados aún"
              : "Sin resultados para la búsqueda"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mostrados.map(cliente => {
            const isOpen = expandedId === cliente.id;
            const promos = getPromos(cliente.puntosTotales);
            const nivelTone = NIVEL_TONE[cliente.nivel] ?? "yellow";

            return (
              <div key={cliente.id} className="neumorphic rounded-2xl overflow-hidden">

                <button
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/30 transition-colors text-left"
                  onClick={() => setExpandedId(isOpen ? null : cliente.id)}
                >
                  <div className="w-9 h-9 rounded-full neumorphic-inset flex items-center justify-center text-xs font-black text-brand-orange shrink-0">
                    {cliente.nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm text-gray-800 truncate">{cliente.nombre}</p>
                      <Badge tone={nivelTone}>{cliente.nivel}</Badge>
                      {cliente.canal && <Badge tone="blue">{CANAL_LABEL[cliente.canal] ?? cliente.canal}</Badge>}
                      {promos.length > 0 && (
                        <Badge tone="green">{promos.length} promo{promos.length > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{cliente.telefono ? `${cliente.telefono} · ` : ""}{cliente.pedidosTotales} pedido{cliente.pedidosTotales !== 1 ? "s" : ""}{cliente.pedidosTotales > 0 ? ` · ${formatMoney(cliente.gastado)} · último ${cliente.ultimoPedido}` : ""}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Star size={12} className="fill-yellow-400 text-yellow-400" />
                        <span className="font-headline font-black text-sm text-gray-800">
                          {cliente.puntosTotales.toLocaleString("es-AR")}
                        </span>
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-200/60 px-4 pb-4 pt-3 space-y-4 animate-rise-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                      {/* Historial de puntos */}
                      <div>
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                          Historial de puntos
                        </p>
                        {cliente.pedidos.length === 0 ? (
                          <div className="neumorphic-inset rounded-xl px-3 py-4 text-center">
                            <p className="text-xs text-gray-500">Sin movimientos aún</p>
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {cliente.pedidos.map(p => (
                              <div key={p.id} className="neumorphic-inset rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] text-gray-500 truncate">{p.items}</p>
                                  <p className="text-[10px] text-gray-500">{p.fecha}</p>
                                </div>
                                <span className={`flex items-center gap-1 text-xs font-black shrink-0 ${p.puntos < 0 ? "text-red-500" : "text-yellow-600"}`}>
                                  <Star size={11} className={p.puntos < 0 ? "text-red-400" : "fill-yellow-400 text-yellow-400"} />
                                  {p.puntos > 0 ? `+${p.puntos}` : p.puntos}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Promociones */}
                      <div>
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                          Promociones disponibles
                        </p>
                        {promos.length === 0 ? (
                          <div className="neumorphic-inset rounded-xl px-3 py-4 text-center">
                            <p className="text-xs text-gray-500">No hay promos disponibles aún</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {promos.map(promo => (
                              <div key={promo.id} className="neumorphic-inset rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-gray-700">{promo.nombre}</p>
                                  <p className="text-[10px] text-gray-500">{promo.descripcion}</p>
                                </div>
                                <Badge tone="yellow" className="shrink-0">{promo.puntosRequeridos} pts</Badge>
                              </div>
                            ))}
                          </div>
                        )}

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
                            onClick={() => announce(`Promo enviada a ${cliente.nombre} (simulado).`)}
                          >
                            Enviar promo
                          </Button>
                        </div>

                        {notifCliente === cliente.id && (
                          <div className="mt-3 neumorphic-inset rounded-xl p-3 space-y-2 animate-rise-in">
                            <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                              Mensaje de notificación
                            </p>
                            <textarea
                              rows={2}
                              placeholder="Ej: ¡Tus puntos están por vencer! Usálos antes del viernes."
                              className="w-full px-3 py-2 rounded-lg neumorphic-inset text-xs text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all resize-none"
                            />
                            <Button
                              fullWidth
                              size="sm"
                              onClick={() => {
                                announce(`Notificación enviada a ${cliente.nombre} (simulado).`);
                                setNotifCliente(null);
                              }}
                            >
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
          {filtrados.length > mostrados.length && (
            <Button variant="secondary" size="sm" fullWidth onClick={() => setVisible(v => v + PAGE_SIZE)}>
              Mostrar más ({filtrados.length - mostrados.length} restantes)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
