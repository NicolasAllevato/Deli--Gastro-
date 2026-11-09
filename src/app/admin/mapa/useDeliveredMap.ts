"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ALL, rangeForPreset, type DeliveredChannel, type DeliveredMapResponse, type DeliveredPreset } from "@/lib/delivered-map";

export interface DeliveredFilterState {
  preset: DeliveredPreset;
  customFrom: string;
  customTo: string;
  channel: DeliveredChannel | typeof ALL;
  courier: string;
}

export interface DeliveredMapState {
  data: DeliveredMapResponse | null;
  loading: boolean;
  error: string | null;
  /** El rango personalizado todavía no es válido: no se consultó nada. */
  invalidRange: boolean;
  refresh: () => Promise<void>;
}

/** Lee los entregados del servidor; si los filtros cambian en medio de una lectura, la anterior se descarta. */
export function useDeliveredMap({ preset, customFrom, customTo, channel, courier }: DeliveredFilterState): DeliveredMapState {
  const [data, setData] = useState<DeliveredMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invalidRange, setInvalidRange] = useState(false);
  const current = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    current.current?.abort();
    const range = rangeForPreset(preset, new Date(), { from: customFrom, to: customTo });
    setInvalidRange(range === null);
    if (!range) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    current.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ ...range, channel, courier });
      const res = await fetch(`/api/orders/delivered?${params}`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("respuesta inválida");
      const body = (await res.json()) as DeliveredMapResponse;
      if (controller.signal.aborted) return;
      setData(body);
      setError(null);
    } catch {
      if (!controller.signal.aborted) setError("No se pudieron cargar los entregados. Probá de nuevo.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [preset, customFrom, customTo, channel, courier]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => current.current?.abort();
  }, [refresh]);

  return { data, loading, error, invalidRange, refresh };
}
