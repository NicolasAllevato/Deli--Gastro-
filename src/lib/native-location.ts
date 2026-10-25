"use client";

/**
 * Fuente de posiciones del repartidor: solo la app Android (Capacitor, carpeta `mobile/repartidor`),
 * con el plugin nativo `BackgroundGeolocation`, que sigue mandando con la pantalla apagada y muestra
 * una notificación fija. En el navegador no se toma la ubicación (se corta al bloquear la pantalla).
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

  // Fuera de la app no se toma la ubicación: el repartidor tiene que usar la app Android.
  onError("unavailable");
  return () => {};
}

/** En la app, si el permiso quedó denegado, abre los ajustes de la app para habilitarlo. */
export function openNativeSettings(): boolean {
  const native = nativePlugin();
  if (!native) return false;
  void native.openSettings();
  return true;
}
