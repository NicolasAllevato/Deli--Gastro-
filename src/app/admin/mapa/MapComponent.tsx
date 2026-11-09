"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RESTAURANT_LOCATION } from "@/lib/restaurant";
import { formatOrderId } from "@/lib/orders";
import { ZoneLayers } from "@/components/zones/ZoneLayers";
import type { DeliveryZone, GeoPoint } from "@/lib/zones";
import type { EnrichedOrder } from "@/lib/orders-server";
import type { CourierLocation } from "@/lib/courier-location";
import { deliveredPoint, deliveryTimes, distanceMeters } from "@/lib/delivery-metrics";

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

const HOME_ICON = dot("#7c3aed", "L");
const COURIER_COLOR = "#16a34a";
const DELIVERED_ICON = dot("#64748b", "✓");

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "R";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

interface Props {
  orders: readonly EnrichedOrder[];
  zones?: readonly DeliveryZone[];
  /** Ubicación del local (configurable); por defecto la fija del proyecto. */
  local?: GeoPoint;
  /** Última posición de cada repartidor con entregas en curso. */
  couriers?: readonly CourierLocation[];
  /** Entregas de hoy con el punto donde el repartidor marcó entregado. */
  delivered?: readonly EnrichedOrder[];
}

export default function MapComponent({ orders, zones = [], local = RESTAURANT_LOCATION, couriers = [], delivered = [] }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const located = orders.filter((o) => o.delivery_lat !== null && o.delivery_lng !== null);
  const courierByName = new Map(couriers.map((c) => [c.courierName, c]));

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden shadow-[inset_5px_5px_10px_#d1d5db,inset_-5px_-5px_10px_#ffffff]">
      <MapContainer center={[local.lat, local.lng]} zoom={13} scrollWheelZoom className="w-full h-[360px] z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ZoneLayers zones={zones} />

        <Marker position={[local.lat, local.lng]} icon={HOME_ICON}>
          <Popup><p className="font-bold text-sm">{RESTAURANT_LOCATION.name} (local)</p></Popup>
        </Marker>

        {located.map((order) => {
          const position: [number, number] = [order.delivery_lat!, order.delivery_lng!];
          const color = STATE_COLOR[order.status] ?? "#6b7280";
          return (
            <span key={order.id}>
              {order.status === "En Camino" && (
                <Polyline
                  positions={[courierStart(order, courierByName, local), position]}
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

        {delivered.map((order) => {
          const where = deliveredPoint(order);
          if (!where) return null;
          const point: [number, number] = [where.lat, where.lng];
          const times = deliveryTimes(order);
          const offBy =
            order.delivered_lat !== null && order.delivery_lat !== null && order.delivery_lng !== null
              ? distanceMeters({ lat: point[0], lng: point[1] }, { lat: order.delivery_lat, lng: order.delivery_lng })
              : null;
          return (
            <span key={`entregado-${order.id}`}>
              {order.delivery_lat !== null && order.delivery_lng !== null && (
                <Polyline
                  positions={[[local.lat, local.lng], point]}
                  pathOptions={{ color: "#64748b", weight: 2, opacity: 0.4 }}
                />
              )}
              <Marker position={point} icon={DELIVERED_ICON}>
                <Popup>
                  <div className="text-sm space-y-0.5">
                    <p className="font-bold text-gray-800">Entregado · {order.client_name} · {formatOrderId(order.id)}</p>
                    {order.courier_name && <p className="text-gray-600">Repartidor: {order.courier_name}</p>}
                    {times.totalMin !== null && <p className="text-gray-600">Tiempo total: {times.totalMin} min</p>}
                    {times.rideMin !== null && <p className="text-gray-600">Viaje: {times.rideMin} min</p>}
                    {offBy !== null && <p className="text-gray-500">A {offBy} m de la dirección cargada</p>}
                  </div>
                </Popup>
              </Marker>
            </span>
          );
        })}

        {couriers.map((c) => (
          <Marker key={c.courierName} position={[c.lat, c.lng]} icon={dot(COURIER_COLOR, escapeHtml(initials(c.courierName)))} zIndexOffset={1000}>
            <Popup>
              <div className="text-sm space-y-0.5">
                <p className="font-bold text-gray-800">{c.courierName}</p>
                <p className="text-gray-500">Actualizado hace {minutesAgo(c.updatedAt)} min</p>
                {c.accuracy !== null && <p className="text-gray-500">Precisión ±{Math.round(c.accuracy)} m</p>}
                {(() => {
                  const entregas = orders.filter((o) => o.courier_name === c.courierName && o.status === "En Camino");
                  return entregas.length > 0 && (
                    <p className="text-gray-600">Lleva: {entregas.map((o) => formatOrderId(o.id)).join(", ")}</p>
                  );
                })()}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

/** La línea de un pedido en camino sale del repartidor si sabemos dónde está; si no, del local. */
function courierStart(
  order: EnrichedOrder,
  courierByName: ReadonlyMap<string, CourierLocation>,
  local: GeoPoint,
): [number, number] {
  const courier = order.courier_name ? courierByName.get(order.courier_name) : undefined;
  return courier ? [courier.lat, courier.lng] : [local.lat, local.lng];
}
