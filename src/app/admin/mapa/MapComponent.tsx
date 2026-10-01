"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RESTAURANT_LOCATION } from "@/lib/restaurant";
import { formatOrderId } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";

// Marcadores como divIcon: no dependen de imágenes externas (la CSP del proyecto
// sólo permite imágenes propias y tiles de OpenStreetMap).
function dot(color: string, label?: string) {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;font:800 11px sans-serif;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)">${label ?? ""}</span>`,
  });
}

const STATE_COLOR: Record<string, string> = {
  "En Camino": "#3b82f6",
  "En Preparación": "#eab308",
  Recibidos: "#ef4444",
};

const HOME_ICON = dot("#6b7c45", "L");
const CENTER: [number, number] = [RESTAURANT_LOCATION.lat - 0.005, RESTAURANT_LOCATION.lng - 0.03];

interface Props {
  orders: readonly EnrichedOrder[];
}

export default function MapComponent({ orders }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const located = orders.filter((o) => o.delivery_lat !== null && o.delivery_lng !== null);

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden shadow-[inset_5px_5px_10px_#d1d5db,inset_-5px_-5px_10px_#ffffff]">
      <MapContainer center={CENTER} zoom={13} scrollWheelZoom className="w-full h-[360px] z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={[RESTAURANT_LOCATION.lat, RESTAURANT_LOCATION.lng]} icon={HOME_ICON}>
          <Popup><p className="font-bold text-sm">{RESTAURANT_LOCATION.name} (local)</p></Popup>
        </Marker>

        {located.map((order) => {
          const position: [number, number] = [order.delivery_lat!, order.delivery_lng!];
          const color = STATE_COLOR[order.status] ?? "#6b7280";
          return (
            <span key={order.id}>
              {order.status === "En Camino" && (
                <Polyline
                  positions={[[RESTAURANT_LOCATION.lat, RESTAURANT_LOCATION.lng], position]}
                  pathOptions={{ color, weight: 3, dashArray: "6 8", opacity: 0.7 }}
                />
              )}
              <Marker position={position} icon={dot(color)}>
                <Popup>
                  <div className="text-sm space-y-0.5">
                    <p className="font-bold text-gray-800">{order.client_name} · {formatOrderId(order.id)}</p>
                    <p className="text-gray-600">{order.status}</p>
                    {order.delivery_address && <p className="text-gray-500">{order.delivery_address}</p>}
                    {order.courier_name && <p className="text-gray-500">Repartidor: {order.courier_name}</p>}
                  </div>
                </Popup>
              </Marker>
            </span>
          );
        })}
      </MapContainer>
    </div>
  );
}
