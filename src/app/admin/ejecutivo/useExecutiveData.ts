"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExecutiveSnapshot } from "@/lib/reports/executive";
import type { ExecutiveSettings, ExecutiveSettingsPatch } from "@/lib/reports/executiveSettings";
import type { RangeKey } from "@/lib/reports/range";
import { TOPIC_ALL_ORDERS } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

export interface ExecutiveFilters {
  range?: RangeKey | null;
  zone?: string | null;
}

interface Loaded {
  key: string;
  data: ExecutiveSnapshot | null;
  error: string | null;
}

export interface UseExecutiveData {
  data: ExecutiveSnapshot | null;
  settings: ExecutiveSettings | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Guarda un parche de ajustes; devuelve null si salió bien o el mensaje de error. */
  saveSettings: (patch: ExecutiveSettingsPatch) => Promise<string | null>;
}

/** En demo no hay tiempo real: se refresca cada 30 s. En producción, al cambiar un pedido (migración 010). */
const DEMO_POLL_MS = 30_000;

const FALLBACK_ERROR = "No se pudo cargar el tablero ejecutivo.";

function buildUrl({ range, zone }: ExecutiveFilters): string {
  const params = new URLSearchParams();
  if (range) params.set("range", range);
  if (zone) params.set("zone", zone);
  const query = params.toString();
  return query ? `/api/admin/executive?${query}` : "/api/admin/executive";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof message === "string" ? message : FALLBACK_ERROR);
  }
  return body as T;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const messageOf = (e: unknown) => (e instanceof Error ? e.message : FALLBACK_ERROR);

export function useExecutiveData(filters: ExecutiveFilters = {}): UseExecutiveData {
  const { range = null, zone = null } = filters;
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<ExecutiveSettings | null>(null);

  const url = useMemo(() => buildUrl({ range, zone }), [range, zone]);
  const key = `${url}#${reloads}`;

  useEffect(() => {
    const controller = new AbortController();
    requestJson<ExecutiveSnapshot>(url, { signal: controller.signal })
      .then((data) => setLoaded({ key, data, error: null }))
      .catch((e: unknown) => {
        if (!isAbort(e)) setLoaded({ key, data: null, error: messageOf(e) });
      });
    return () => controller.abort();
  }, [url, key]);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<ExecutiveSettings>("/api/admin/executive/settings", { signal: controller.signal })
      .then(setSettings)
      .catch(() => {
        /* Sin ajustes el tablero igual funciona con los valores por defecto del servidor. */
      });
    return () => controller.abort();
  }, []);

  const refetch = useCallback(() => setReloads((n) => n + 1), []);

  // Los KPIs salen de `orders`: cada pedido nuevo o actualizado recalcula el tablero.
  useLiveRefresh({ topic: TOPIC_ALL_ORDERS, refresh: refetch, demoPollMs: DEMO_POLL_MS });

  const saveSettings = useCallback(async (patch: ExecutiveSettingsPatch): Promise<string | null> => {
    try {
      const saved = await requestJson<ExecutiveSettings>("/api/admin/executive/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSettings(saved);
      setReloads((n) => n + 1);
      return null;
    } catch (e: unknown) {
      return messageOf(e);
    }
  }, []);

  const current = loaded?.key === key ? loaded : null;
  return {
    // Mientras llega la respuesta nueva se sigue mostrando el último dato para no parpadear.
    data: current?.data ?? loaded?.data ?? null,
    settings,
    loading: current === null,
    error: current?.error ?? null,
    refetch,
    saveSettings,
  };
}
