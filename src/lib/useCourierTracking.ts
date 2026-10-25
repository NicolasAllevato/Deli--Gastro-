"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCATION_SEND_MS } from "@/lib/courier-location";
import { isNativeApp, watchFixes, type Fix } from "@/lib/native-location";

export type TrackingState = "off" | "starting" | "on" | "denied" | "unavailable";

const ENDPOINT = "/api/couriers/location";
/** Una posición más vieja que esto no sirve como punto de entrega. */
const DELIVERED_POINT_MAX_AGE_MS = 2 * 60_000;

export interface DeliveredPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export interface CourierTracking {
  state: TrackingState;
  /** Dentro de la app Android. `null` hasta montar (en el servidor no se sabe). */
  native: boolean | null;
  /** Última posición reciente para marcar dónde se entregó; null si no hay. */
  deliveredPoint: () => DeliveredPoint | null;
}

/**
 * Comparte la posición del repartidor mientras `active` (tiene entregas asignadas).
 * La ubicación sale solo de la app Android (GPS nativo, sigue con la pantalla bloqueada);
 * desde el navegador no se toma. El GPS avisa cada vez que se mueve, pero al servidor
 * se manda como mucho cada 15 s. Al dejar de estar activo se borra la última posición guardada.
 */
export function useCourierTracking(active: boolean): CourierTracking {
  const [state, setState] = useState<TrackingState>("off");
  const [native, setNative] = useState<boolean | null>(null);
  const lastSent = useRef(0);
  const lastFix = useRef<{ fix: Fix; at: number } | null>(null);

  useEffect(() => {
    // El puente de Capacitor solo existe en el cliente: se consulta después de montar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNative(isNativeApp());
  }, []);

  const canWatch = active && native === true;

  useEffect(() => {
    if (!canWatch) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("starting");

    const send = (fix: Fix) => {
      const now = Date.now();
      if (now - lastSent.current < LOCATION_SEND_MS) return;
      lastSent.current = now;
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fix),
      }).catch(() => {
        // Sin red: se manda con la próxima posición.
        lastSent.current = 0;
      });
    };

    const stop = watchFixes(
      (fix) => {
        lastFix.current = { fix, at: Date.now() };
        setState("on");
        send(fix);
      },
      (error) => setState(error),
    );

    return () => {
      stop();
      lastSent.current = 0;
      setState("off");
      void fetch(ENDPOINT, { method: "DELETE", keepalive: true }).catch(() => {});
    };
  }, [canWatch]);

  const deliveredPoint = useCallback((): DeliveredPoint | null => {
    const last = lastFix.current;
    if (!last || Date.now() - last.at > DELIVERED_POINT_MAX_AGE_MS) return null;
    return { lat: last.fix.lat, lng: last.fix.lng, accuracy: last.fix.accuracy };
  }, []);

  return { state, native, deliveredPoint };
}
