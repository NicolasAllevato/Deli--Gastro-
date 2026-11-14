/**
 * Etapa 4 del corte (DATA_BACKEND=d1): reemplazo de Supabase Realtime por consulta de versión
 * cada 5 s (opción 1 elegida por el usuario). Un único poller por topic, compartido por todas
 * las pantallas que lo escuchan, con la misma interfaz que el canal de Broadcast:
 * - onPing: la versión cambió (como el aviso "changed").
 * - onReconnect: la consulta volvió a responder después de fallar (como la reconexión).
 * La primera respuesta solo fija la versión de base: no dispara un refresco.
 */
export const VERSION_POLL_MS = 5_000;

export type FetchVersion = (topic: string) => Promise<number>;

interface Poller {
  pings: Set<() => void>;
  reconnects: Set<() => void>;
  version: number | null;
  failing: boolean;
  timer: ReturnType<typeof setInterval>;
}

export interface VersionPollerOptions {
  fetchVersion: FetchVersion;
  intervalMs?: number;
  /** Saltea la consulta (p. ej. pestaña oculta). */
  paused?: () => boolean;
}

export function createVersionPollers({ fetchVersion, intervalMs = VERSION_POLL_MS, paused = () => false }: VersionPollerOptions) {
  const pollers = new Map<string, Poller>();

  async function tick(topic: string, p: Poller): Promise<void> {
    if (paused()) return;
    let next: number;
    try {
      next = await fetchVersion(topic);
    } catch {
      p.failing = true;
      return;
    }
    if (pollers.get(topic) !== p) return;
    const recovered = p.failing;
    p.failing = false;
    const changed = p.version !== null && next !== p.version;
    p.version = next;
    if (recovered) p.reconnects.forEach((fn) => fn());
    else if (changed) p.pings.forEach((fn) => fn());
  }

  function subscribe(topic: string, onPing: () => void, onReconnect: () => void): () => void {
    let p = pollers.get(topic);
    if (!p) {
      const created: Poller = { pings: new Set(), reconnects: new Set(), version: null, failing: false, timer: undefined as never };
      created.timer = setInterval(() => void tick(topic, created), intervalMs);
      pollers.set(topic, created);
      void tick(topic, created);
      p = created;
    }
    const current = p;
    current.pings.add(onPing);
    current.reconnects.add(onReconnect);
    return () => {
      current.pings.delete(onPing);
      current.reconnects.delete(onReconnect);
      if (current.pings.size > 0 || pollers.get(topic) !== current) return;
      clearInterval(current.timer);
      pollers.delete(topic);
    };
  }

  return { subscribe, size: () => pollers.size };
}

/** Consulta real contra /api/live/version (solo navegador). */
export async function fetchLiveVersion(topic: string): Promise<number> {
  const res = await fetch(`/api/live/version?topics=${encodeURIComponent(topic)}`, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`live ${res.status}`);
  const json = (await res.json()) as { versions?: Record<string, number> };
  return Number(json.versions?.[topic] ?? 0);
}
