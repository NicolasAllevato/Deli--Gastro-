"use client";

import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Point {
  lat: number;
  lng: number;
}

// divIcon: sin imágenes externas (la CSP solo permite imágenes propias y tiles de OpenStreetMap).
function dot(color: string, label: string) {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;font:800 11px sans-serif;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)">${label}</span>`,
  });
}

const REQUESTED_ICON = dot("#7c3aed", "P");
const DELIVERED_ICON = dot("#16a34a", "E");

/** Punto pedido (P) y punto donde se marcó entregado (E), unidos por una línea. */
export default function TraceMap({ requested, delivered }: { requested: Point | null; delivered: Point | null }) {
  const points = [requested, delivered].filter((p): p is Point => p !== null);
  if (points.length === 0) return null;
  const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.5);

  return (
    <div
      role="region"
      aria-label="Mapa con el punto pedido y el punto de entrega"
      className="w-full h-[280px] rounded-2xl overflow-hidden border border-[var(--app-border)]"
    >
      <MapContainer bounds={bounds} maxZoom={18} scrollWheelZoom={false} className="w-full h-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {requested && (
          <Marker position={[requested.lat, requested.lng]} icon={REQUESTED_ICON}>
            <Popup>Punto pedido</Popup>
          </Marker>
        )}
        {delivered && (
          <Marker position={[delivered.lat, delivered.lng]} icon={DELIVERED_ICON}>
            <Popup>Punto de entrega</Popup>
          </Marker>
        )}
        {requested && delivered && (
          <Polyline positions={[[requested.lat, requested.lng], [delivered.lat, delivered.lng]]} pathOptions={{ color: "#7c3aed", dashArray: "6 6" }} />
        )}
      </MapContainer>
    </div>
  );
}
