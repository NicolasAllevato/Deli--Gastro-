"use client";

import { useSyncExternalStore } from "react";
import { CheckCircle2, CloudOff, Loader2, AlertTriangle } from "lucide-react";

interface Props {
  loading: boolean;
  error: string | null;
  /** Pedidos del período que devolvió la base; null mientras no hubo respuesta. */
  orders: number | null;
}

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Estado de la conexión con la base: cargando, conectado (con hora y cantidad), error o sin internet. */
export function DataStatus({ loading, error, orders }: Props) {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  let icon = <Loader2 size={14} className="animate-spin" aria-hidden="true" />;
  let text = "Conectando con la base de datos…";
  let tone = "exec-muted";

  if (!online) {
    icon = <CloudOff size={14} aria-hidden="true" />;
    text = "Sin conexión a internet: los datos pueden estar desactualizados.";
    tone = "text-red-500";
  } else if (error) {
    icon = <AlertTriangle size={14} aria-hidden="true" />;
    text = `No se pudo leer la base de datos: ${error}`;
    tone = "text-red-500";
  } else if (!loading && orders !== null) {
    icon = <CheckCircle2 size={14} aria-hidden="true" />;
    text = `Conectado a la base · ${orders} pedido${orders === 1 ? "" : "s"} en el período`;
    tone = "text-green-500";
  } else if (loading && orders !== null) {
    text = "Actualizando datos…";
  }

  return (
    <p role="status" aria-live="polite" className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
      {icon}
      <span>{text}</span>
    </p>
  );
}
