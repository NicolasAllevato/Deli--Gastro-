"use client";

import { Circle, Polygon, Tooltip } from "react-leaflet";
import type { DeliveryZone } from "@/lib/zones";
import { formatMoney } from "@/lib/orders";

const PALETTE = ["#7c3aed", "#3b82f6", "#eab308", "#ef4444", "#8b5cf6", "#14b8a6"] as const;

export function zoneColor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

interface Props {
  zones: readonly DeliveryZone[];
  /** Zona resaltada (la que se está editando). */
  selectedId?: string | null;
}

/** Dibuja las zonas de entrega sobre un mapa de react-leaflet. */
export function ZoneLayers({ zones, selectedId = null }: Props) {
  return (
    <>
      {zones.map((zone, index) => {
        const color = zone.is_active ? zoneColor(index) : "#9ca3af";
        const selected = zone.id === selectedId;
        const pathOptions = {
          color,
          weight: selected ? 4 : 2,
          fillOpacity: selected ? 0.25 : 0.12,
          dashArray: zone.is_active ? undefined : "6 6",
        };
        const tooltip = (
          <Tooltip sticky>
            {zone.name} · {formatMoney(zone.fee)}
            {zone.min_order > 0 ? ` · mínimo ${formatMoney(zone.min_order)}` : ""}
          </Tooltip>
        );

        return zone.shape.type === "circle" ? (
          <Circle
            key={zone.id}
            center={[zone.shape.lat, zone.shape.lng]}
            radius={zone.shape.radius_km * 1000}
            pathOptions={pathOptions}
          >
            {tooltip}
          </Circle>
        ) : (
          <Polygon
            key={zone.id}
            positions={zone.shape.points.map(([lat, lng]) => [lat, lng] as [number, number])}
            pathOptions={pathOptions}
          >
            {tooltip}
          </Polygon>
        );
      })}
    </>
  );
}
