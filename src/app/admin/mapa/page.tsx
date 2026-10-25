"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapPin, Search, Bike, Clock, ClipboardCheck } from "lucide-react";
import { formatOrderId, minutesSince } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";
import type { DeliveryZone, GeoPoint } from "@/lib/zones";
import { TOPIC_ALL_ORDERS } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import type { CourierLocation } from "@/lib/courier-location";
import { isSameLocalDay } from "@/lib/delivery-metrics";

const MapComponent = dynamic(() => import("./MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[360px] flex items-center justify-center rounded-2xl neumorphic-inset">
      <div className="text-gray-500 flex flex-col items-center gap-2 animate-pulse">
        <MapPin className="w-8 h-8" />
        <p className="font-bold text-sm">Cargando mapa...</p>
      </div>
    </div>
  ),
});

const DEMO_POLL_MS = 5000;
/** Las posiciones llegan cada 15 s desde el teléfono del repartidor. */
const COURIER_POLL_MS = 10_000;
const MAP_STATUSES = ["Recibidos", "En Preparación", "En Camino"] as const;

const estadoIcon: Record<string, React.ReactNode> = {
  "En Camino":      <Bike size={14} className="text-blue-500" />,
  "En Preparación": <Clock size={14} className="text-yellow-500" />,
  Recibidos:        <ClipboardCheck size={14} className="text-red-500" />,
};

export default function MapaPage() {
  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  const [delivered, setDelivered] = useState<EnrichedOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [local, setLocal] = useState<GeoPoint | undefined>(undefined);
  const [couriers, setCouriers] = useState<CourierLocation[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/couriers/location", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<CourierLocation[]>) : null))
        .then((data) => { if (data && !cancelled) setCouriers(data); })
        .catch(() => { /* sin red: se reintenta en el próximo ciclo */ });
    void load();
    const id = setInterval(load, COURIER_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Las zonas casi no cambian: se piden una sola vez (el mapa funciona igual si falla).
  useEffect(() => {
    fetch("/api/zones", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ zones: DeliveryZone[]; local: GeoPoint }>) : null))
      .then((data) => {
        if (!data) return;
        setZones(data.zones);
        setLocal(data.local);
      })
      .catch(() => { /* sin zonas: solo se muestran los pedidos */ });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (!res.ok) return;
      const all = (await res.json()) as EnrichedOrder[];
      setOrders(all.filter((o) => (MAP_STATUSES as readonly string[]).includes(o.status)));
      // Entregas de hoy con punto de entrega: cierran el recorrido de cada repartidor en el mapa.
      setDelivered(all.filter((o) => o.status === "Finalizados" && o.delivered_lat !== null && isSameLocalDay(o.delivered_at)));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLiveRefresh({ topic: TOPIC_ALL_ORDERS, refresh, demoPollMs: DEMO_POLL_MS });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.client_name, o.delivery_address ?? "", formatOrderId(o.id)].some((v) => v.toLowerCase().includes(q)),
    );
  }, [orders, query]);

  const enRuta = orders.filter((o) => o.status === "En Camino").length;

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
          {enRuta} en ruta · {couriers.length} {couriers.length === 1 ? "repartidor" : "repartidores"} en el mapa
        </span>
      </div>

      {/* Mapa */}
      <div className="neumorphic rounded-2xl p-1 overflow-hidden">
        <MapComponent orders={visible} zones={zones} local={local} couriers={couriers} delivered={delivered} />
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar por cliente, dirección o número de pedido"
          placeholder="Buscar cliente, dirección o pedido..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all"
        />
      </div>

      {/* Lista de entregas activas */}
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-1">Entregas activas</p>
        {loaded && visible.length === 0 ? (
          <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">
            No hay entregas activas.
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((entrega) => (
              <Link
                key={entrega.id}
                href={`/admin/pedidos/${entrega.id}`}
                className="neumorphic rounded-xl p-3.5 flex items-center gap-3 neumorphic-hover"
              >
                <div className="w-8 h-8 rounded-full neumorphic-inset flex items-center justify-center shrink-0">
                  {estadoIcon[entrega.status]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-800 truncate">
                    {entrega.client_name} <span className="text-gray-400 font-medium">· {formatOrderId(entrega.id)}</span>
                  </p>
                  <p className="text-xs text-gray-500 truncate">{entrega.delivery_address ?? "Sin dirección"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-bold text-gray-600">{entrega.status}</p>
                  <p className="text-[11px] text-gray-500">hace {minutesSince(entrega.created_at)} min</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
