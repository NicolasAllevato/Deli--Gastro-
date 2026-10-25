"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCATION_SEND_MS } from "@/lib/courier-location";
import { isNativeApp, watchFixes, type Fix } from "@/lib/native-location";

export type TrackingState = "off" | "starting" | "on" | "denied" | "unavailable";
/** Permiso del navegador. `unknown`: el navegador no deja consultarlo (Safari viejo) hasta pedirlo. */
export type LocationPermission = "granted" | "prompt" | "denied" | "unsupported" | "unknown";

const ENDPOINT = "/api/couriers/location";

export interface CourierTracking {
  state: TrackingState;
  permission: LocationPermission;
  /** Pide el permiso con un gesto del usuario (botón): los navegadores móviles lo exigen. */
  requestPermission: () => void;
}

function useLocationPermission(): [LocationPermission, (p: LocationPermission) => void] {
  const [permission, setPermission] = useState<LocationPermission>("unknown");

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPermission("unsupported");
      return;
    }
    if (!navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const sync = () => status && setPermission(status.state);
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        status = s;
        sync();
        s.addEventListener("change", sync);
      })
      .catch(() => { /* queda en unknown: se resuelve al pedirlo */ });
    return () => status?.removeEventListener("change", sync);
  }, []);

  return [permission, setPermission];
}

/**
 * Comparte la posición del repartidor mientras `active` (tiene entregas asignadas) y el permiso está dado.
 * El GPS avisa cada vez que se mueve, pero al servidor se manda como mucho cada 15 s.
 * Al dejar de estar activo se borra la última posición guardada.
 */
export function useCourierTracking(active: boolean): CourierTracking {
  const [state, setState] = useState<TrackingState>("off");
  const [permission, setPermission] = useLocationPermission();
  const lastSent = useRef(0);

  const requestPermission = useCallback(() => {
    if (permission === "unsupported") return;
    navigator.geolocation.getCurrentPosition(
      () => setPermission("granted"),
      (err) => setPermission(err.code === err.PERMISSION_DENIED ? "denied" : "granted"),
      { enableHighAccuracy: true, timeout: 30_000 },
    );
  }, [permission, setPermission]);

  // Con `unknown` también se arranca: watchPosition dispara el pedido de permiso del navegador.
  // En la app el plugin nativo pide el permiso él mismo (incluido el de segundo plano).
  const canWatch = active && (isNativeApp() || permission === "granted" || permission === "unknown");

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
        setState("on");
        setPermission("granted");
        send(fix);
      },
      (error) => {
        if (error === "denied") setPermission("denied");
        setState(error);
      },
    );

    return () => {
      stop();
      lastSent.current = 0;
      setState("off");
      void fetch(ENDPOINT, { method: "DELETE", keepalive: true }).catch(() => {});
    };
  }, [canWatch, setPermission]);

  return { state: active && permission === "denied" ? "denied" : state, permission, requestPermission };
}

export interface DeliveredPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
}

/**
 * Posición actual para marcar el punto de entrega. Nunca frena la entrega: sin permiso,
 * sin GPS o si tarda más de 8 s, devuelve null y el pedido se cierra igual.
 */
export function currentDeliveredPoint(): Promise<DeliveredPoint | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 8_000 },
    );
  });
}
