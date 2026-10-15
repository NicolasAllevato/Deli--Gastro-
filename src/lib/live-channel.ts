"use client";

import { createClient } from "@/utils/supabase/client";

type Channel = ReturnType<ReturnType<typeof createClient>["channel"]>;

interface Entry {
  channel: Channel;
  pings: Set<() => void>;
  reconnects: Set<() => void>;
  connected: boolean;
  closeTimer?: number;
}

/** Cuánto se mantiene abierto un canal sin oyentes: cubre el cambio de pantalla. */
const LINGER_MS = 2000;

const entries = new Map<string, Entry>();
/** Canales que se están cerrando: hay que esperar el cierre antes de reabrir el mismo topic. */
const closing = new Map<string, Promise<unknown>>();

function open(topic: string): Entry {
  const entry: Entry = {
    channel: undefined as unknown as Channel,
    pings: new Set(),
    reconnects: new Set(),
    connected: false,
  };
  entry.channel = createClient()
    .channel(topic)
    .on("broadcast", { event: "changed" }, () => entry.pings.forEach((fn) => fn()))
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Tras reconectar pudo haber cambios que no llegaron: los oyentes se ponen al día.
      if (entry.connected) entry.reconnects.forEach((fn) => fn());
      entry.connected = true;
    });
  entries.set(topic, entry);
  return entry;
}

function close(topic: string, entry: Entry): void {
  if (entries.get(topic) !== entry || entry.pings.size > 0) return;
  entries.delete(topic);
  const done: Promise<unknown> = createClient()
    .removeChannel(entry.channel)
    .catch(() => undefined)
    .finally(() => {
      if (closing.get(topic) === done) closing.delete(topic);
    });
  closing.set(topic, done);
}

/**
 * Suscribe a los avisos de un topic compartiendo un único canal por topic.
 * `supabase.channel(topic)` devuelve el canal existente aunque se esté cerrando, y suscribirse
 * a ese canal no hace nada: sin este registro, pasar de una pantalla a otra con el mismo topic
 * dejaba a la segunda sin avisos.
 */
export function subscribeToTopic(topic: string, onPing: () => void, onReconnect: () => void): () => void {
  let cancelled = false;
  let entry: Entry | undefined;

  const attach = () => {
    if (cancelled) return;
    entry = entries.get(topic) ?? open(topic);
    window.clearTimeout(entry.closeTimer);
    entry.pings.add(onPing);
    entry.reconnects.add(onReconnect);
  };

  const pending = closing.get(topic);
  if (pending) void pending.then(attach);
  else attach();

  return () => {
    cancelled = true;
    if (!entry) return;
    const current = entry;
    current.pings.delete(onPing);
    current.reconnects.delete(onReconnect);
    if (current.pings.size > 0) return;
    current.closeTimer = window.setTimeout(() => close(topic, current), LINGER_MS);
  };
}
