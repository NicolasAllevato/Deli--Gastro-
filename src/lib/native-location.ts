"use client";

/**
 * Fuente de posiciones del repartidor. En el navegador usa `navigator.geolocation` (se corta con la
 * pantalla bloqueada). Dentro de la app Android (Capacitor, carpeta `mobile/repartidor`) usa el plugin
 * nativo `BackgroundGeolocation`, que sigue mandando con la pantalla apagada y muestra una notificación fija.
 * La web no importa `@capacitor/core`: el puente lo inyecta la app en `window.Capacitor`.
 */

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export type WatchError = "denied" | "unavailable";

interface NativeLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  bearing: number | null;
  speed: number | null;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundTitle?: string;
      backgroundMessage?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (location?: NativeLocation, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  registerPlugin?: <T>(name: string) => T;
}

function nativePlugin(): BackgroundGeolocationPlugin | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.registerPlugin) return null;
  return cap.registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
}

export function isNativeApp(): boolean {
  return nativePlugin() !== null;
}

const finite = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Empieza a escuchar posiciones. Devuelve la función que corta. */
export function watchFixes(onFix: (fix: Fix) => void, onError: (error: WatchError) => void): () => void {
  const native = nativePlugin();
  if (native) {
    let id: string | null = null;
    let stopped = false;
    native
      .addWatcher(
        {
          backgroundTitle: "Opsyn Dely · Repartidor",
          backgroundMessage: "Compartiendo tu ubicación con el local mientras tenés entregas.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 20,
        },
        (location, error) => {
          if (error) return onError(error.code === "NOT_AUTHORIZED" ? "denied" : "unavailable");
          if (!location) return;
          onFix({
            lat: location.latitude,
            lng: location.longitude,
            accuracy: finite(location.accuracy),
            heading: finite(location.bearing),
            speed: finite(location.speed),
          });
        },
      )
      .then((watcherId) => {
        if (stopped) void native.removeWatcher({ id: watcherId });
        else id = watcherId;
      })
      .catch(() => onError("unavailable"));
    return () => {
      stopped = true;
      if (id) void native.removeWatcher({ id });
    };
  }

  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    onError("unavailable");
    return () => {};
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: finite(pos.coords.accuracy),
        heading: finite(pos.coords.heading),
        speed: finite(pos.coords.speed),
      }),
    (err) => onError(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(watchId);
}

/** En la app, si el permiso quedó denegado, abre los ajustes de la app para habilitarlo. */
export function openNativeSettings(): boolean {
  const native = nativePlugin();
  if (!native) return false;
  void native.openSettings();
  return true;
}
