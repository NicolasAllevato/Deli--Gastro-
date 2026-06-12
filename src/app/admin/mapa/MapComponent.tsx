"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { mockEntregas } from "@/fixtures/orders";

// Fix para el icono de Leaflet en Next.js
const customIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function MapComponent() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const centro: [number, number] = [-34.6050, -58.3750];

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden shadow-[inset_5px_5px_10px_#d1d5db,inset_-5px_-5px_10px_#ffffff]">
      <MapContainer center={centro} zoom={14} scrollWheelZoom={true} className="w-full h-[300px] z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        {mockEntregas.map((entrega) => (
          <Marker key={entrega.id} position={[entrega.lat, entrega.lng]} icon={customIcon}>
            <Popup>
              <div className="text-sm">
                <p className="font-bold text-gray-800">{entrega.cliente}</p>
                <p className="text-gray-600">Estado: {entrega.estado}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
