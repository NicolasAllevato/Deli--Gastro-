"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FALLBACK_POLL_MS } from "@/lib/live-refresh";
import {
  derivacionesPorAvisar,
  guardarVistos,
  leerVistos,
  podarVistos,
  textoNotificacion,
  type DerivacionAviso,
} from "@/lib/conversaciones/aviso-derivacion";
import { sonar } from "./sonido-aviso";

type Permiso = NotificationPermission | "unsupported";

const TITULO = "Cliente esperando atención";
const href = (id: string) => `/admin/conversaciones?id=${encodeURIComponent(id)}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function permisoActual(): Permiso {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

/** Notificación del sistema; al hacer clic enfoca la ventana y abre la conversación. */
function notificar(d: DerivacionAviso, ir: (url: string) => void): void {
  try {
    const n = new Notification(TITULO, { body: textoNotificacion(d), tag: `derivacion-${d.id}` });
    n.onclick = () => {
      window.focus();
      n.close();
      ir(href(d.id));
    };
  } catch {
    /* algunos navegadores móviles solo permiten notificaciones desde un service worker */
  }
}

/**
 * Aviso de conversaciones que el bot pasó a una persona: banner en la app, sonido y notificación de escritorio.
 * Cada derivación se avisa una sola vez (vistos en localStorage). `enabled` en false no consulta nada.
 */
export function DerivacionAlert({ enabled }: { enabled: boolean }) {
  const [derivadas, setDerivadas] = useState<DerivacionAviso[]>([]);
  const [descartadas, setDescartadas] = useState<ReadonlySet<string>>(new Set());
  const [permiso, setPermiso] = useState<Permiso>(permisoActual);
  const audio = useRef<AudioContext | null>(null);
  const vistos = useRef<Set<string> | null>(null);

  const ir = useCallback((url: string) => {
    window.location.assign(url);
  }, []);

  const avisar = useCallback(
    (lista: DerivacionAviso[]) => {
      vistos.current ??= leerVistos(storage());
      const nuevas = derivacionesPorAvisar(lista, vistos.current);
      const podados = podarVistos(vistos.current, lista);
      for (const d of nuevas) podados.add(d.id);
      vistos.current = podados;
      guardarVistos(storage(), podados);
      if (nuevas.length === 0) return;
      void sonar(audio);
      if (permisoActual() === "granted") nuevas.forEach((d) => notificar(d, ir));
    },
    [ir],
  );

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      fetch("/api/admin/conversaciones/derivadas", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<DerivacionAviso[]>) : null))
        .then((lista) => {
          if (!alive || !Array.isArray(lista)) return;
          setDerivadas(lista);
          avisar(lista);
        })
        .catch(() => {
          /* sin red: se reintenta en el próximo ciclo */
        });
    void load();
    const timer = setInterval(load, FALLBACK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, avisar]);

  const activarEscritorio = () => {
    if (permisoActual() === "unsupported") return;
    void Notification.requestPermission().then(setPermiso);
    void sonar(audio);
  };

  if (!enabled) return null;
  const visibles = derivadas.filter((d) => !descartadas.has(d.id));
  const pedirPermiso = permiso === "default";
  const denegado = permiso === "denied";
  if (visibles.length === 0 && !(pedirPermiso && derivadas.length > 0)) return null;

  return (
    <div role="status" className="mx-3 mb-2 px-4 py-2.5 rounded-2xl neumorphic space-y-2 text-sm text-gray-700">
      {visibles.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2">
          <UserRound size={16} aria-hidden className="text-brand-orange shrink-0" />
          <span className="font-bold">{TITULO}</span>
          <span className="min-w-0 truncate">{textoNotificacion(d)}</span>
          <Link href={href(d.id)} className="ml-auto font-bold text-brand-orange hover:underline">
            Ver conversación
          </Link>
          <button
            type="button"
            aria-label={`Descartar aviso de ${d.nombre}`}
            onClick={() => setDescartadas((prev) => new Set([...prev, d.id]))}
            className="p-1 rounded-full text-gray-500 hover:text-brand-orange"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
      {pedirPermiso && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <BellRing size={14} aria-hidden className="text-brand-orange" />
          <span>Para recibir el aviso como notificación en el escritorio, activalo.</span>
          <Button size="sm" variant="secondary" onClick={activarEscritorio}>
            Activar avisos de escritorio
          </Button>
        </div>
      )}
      {denegado && (
        <p className="text-xs text-gray-600">
          Las notificaciones del navegador están bloqueadas. Habilitalas desde el candado junto a la dirección del sitio (Notificaciones: Permitir) y recargá la página.
        </p>
      )}
    </div>
  );
}
