"use client";

import { useEffect, useRef } from "react";
import { subscribeToTopic } from "@/lib/live-channel";
import { isDemoMode } from "@/lib/demo/mode";
import { PING_DEBOUNCE_MS, planLiveRefresh } from "@/lib/live-refresh";

interface Options {
  /** Canal de Broadcast al que suscribirse (ver `TOPIC_ALL_ORDERS` / `orderTopic`). */
  topic: string;
  /** Vuelve a pedir los datos a la API. */
  refresh: () => void | Promise<void>;
  /** Intervalo de consulta en modo demo, donde no hay tiempo real. */
  demoPollMs: number;
  /** false = no hacer nada (p. ej. un pedido ya finalizado). */
  enabled?: boolean;
}

/**
 * Mantiene una pantalla al día: se suscribe a los avisos de cambio y refresca al recibirlos.
 * Los avisos no traen datos; la fuente de verdad sigue siendo la API.
 */
export function useLiveRefresh({ topic, refresh, demoPollMs, enabled = true }: Options): void {
  // El callback cambia en cada render: se guarda en una ref para no re-suscribirse cada vez.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const plan = planLiveRefresh({ demo: isDemoMode(), enabled, demoPollMs });
    const cleanups: Array<() => void> = [];
    const run = () => void refreshRef.current();

    if (plan.pollMs !== null) {
      const timer = window.setInterval(run, plan.pollMs);
      cleanups.push(() => window.clearInterval(timer));
    }

    if (plan.subscribe) {
      let debounce: number | undefined;
      const onPing = () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(run, PING_DEBOUNCE_MS);
      };
      const unsubscribe = subscribeToTopic(topic, onPing, run);

      cleanups.push(() => {
        window.clearTimeout(debounce);
        unsubscribe();
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [topic, enabled, demoPollMs]);
}
