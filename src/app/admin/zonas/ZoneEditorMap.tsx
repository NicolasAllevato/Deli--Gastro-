"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Circle, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ZoneLayers } from "@/components/zones/ZoneLayers";
import type { DeliveryZone, GeoPoint, ZoneShape } from "@/lib/zones";

const HOME_ICON = L.divIcon({
  className: "",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  html: `<span style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:#6b7c45;color:#fff;font:800 11px sans-serif;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)">L</span>`,
});

const VERTEX_ICON = L.divIcon({
  className: "",
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  html: `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#ff7b00;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
});

const DRAFT_STYLE = { color: "#ff7b00", weight: 3, dashArray: "4 6", fillOpacity: 0.2 } as const;

function ClickHandler({ onPick }: { onPick: (point: GeoPoint) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

interface Props {
  zones: readonly DeliveryZone[];
  local: GeoPoint;
  draft: ZoneShape | null;
  editingId: string | null;
  /** true = hay una herramienta activa y los clics en el mapa se interpretan. */
  picking: boolean;
  onPick: (point: GeoPoint) => void;
}

export default function ZoneEditorMap({ zones, local, draft, editingId, picking, onPick }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // La zona que se edita se dibuja como borrador, no como capa guardada.
  const saved = zones.filter((z) => z.id !== editingId);

  return (
    <div className={`w-full rounded-2xl overflow-hidden ${picking ? "cursor-crosshair" : ""}`}>
      <MapContainer center={[local.lat, local.lng]} zoom={13} scrollWheelZoom className="w-full h-[420px] z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onPick={onPick} />
        <Marker position={[local.lat, local.lng]} icon={HOME_ICON} />
        <ZoneLayers zones={saved} />

        {draft?.type === "circle" && (
          <Circle center={[draft.lat, draft.lng]} radius={draft.radius_km * 1000} pathOptions={DRAFT_STYLE} />
        )}
        {draft?.type === "polygon" && (
          <>
            {draft.points.length >= 2 && (
              <Polyline
                positions={[...draft.points, draft.points[0]!].map(([lat, lng]) => [lat, lng] as [number, number])}
                pathOptions={DRAFT_STYLE}
              />
            )}
            {draft.points.map(([lat, lng], i) => (
              <Marker key={`${lat},${lng},${i}`} position={[lat, lng]} icon={VERTEX_ICON} />
            ))}
          </>
        )}
      </MapContainer>
    </div>
  );
}
