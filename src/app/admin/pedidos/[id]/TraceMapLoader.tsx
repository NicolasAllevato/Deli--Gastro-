"use client";

import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";

// Leaflet usa `window`: solo en el navegador.
const TraceMap = dynamic(() => import("./TraceMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[280px] flex items-center justify-center rounded-2xl neumorphic-inset text-gray-500">
      <MapPin className="w-6 h-6 animate-pulse" aria-hidden />
      <span className="sr-only">Cargando mapa</span>
    </div>
  ),
});

export default function TraceMapLoader(props: { requested: { lat: number; lng: number } | null; delivered: { lat: number; lng: number } | null }) {
  return <TraceMap {...props} />;
}
