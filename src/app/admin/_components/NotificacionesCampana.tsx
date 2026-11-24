"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Headset, MessageSquareWarning, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { isDemoMode } from "@/lib/demo/mode";
import { subscribeToTopic } from "@/lib/live-channel";
import {
  FALLBACK_POLL_MS,
  PING_DEBOUNCE_MS,
  TOPIC_ALL_ORDERS,
  TOPIC_COURIER_SHIFTS,
  TOPIC_WA_CONVERSATIONS,
  planLiveRefresh,
} from "@/lib/live-refresh";
import {
  contarNoVistas,
  fechaMasNueva,
  haceCuanto,
  type Notificacion,
  type NotificacionTipo,
  type NotificacionesRespuesta,
} from "@/lib/notificaciones/armado";

const STORAGE_KEY = "admin-notificaciones-visto-hasta";
const TOPICS = [TOPIC_ALL_ORDERS, TOPIC_WA_CONVERSATIONS, TOPIC_COURIER_SHIFTS] as const;

const ICONOS: Record<NotificacionTipo, LucideIcon> = {
  pedido: ShoppingBag,
  derivacion: Headset,
  reclamo: MessageSquareWarning,
  habilitacion: Truck,
};

type Estado = { fase: "cargando" } | { fase: "error" } | { fase: "listo"; items: Notificacion[] };

function leerVistoHasta(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function guardarVistoHasta(iso: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, iso);
  } catch {
    /* sin almacenamiento (modo privado): el contador vuelve a aparecer al recargar */
  }
}

/** Carga al montar y refresca con los avisos en tiempo real de pedidos, conversaciones y habilitaciones, más un respaldo cada 30 s. */
function useRefrescoNotificaciones(refresh: () => void): void {
  const ref = useRef(refresh);
  useEffect(() => {
    ref.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const plan = planLiveRefresh({ demo: isDemoMode(), enabled: true, demoPollMs: FALLBACK_POLL_MS });
    const run = () => ref.current();
    const cleanups: Array<() => void> = [];
    run(); // carga inicial
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
      for (const topic of TOPICS) cleanups.push(subscribeToTopic(topic, onPing, run));
      cleanups.push(() => window.clearTimeout(debounce));
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);
}

/** Campana de la barra superior: desplegable con las novedades del panel según los permisos del usuario. */
export function NotificacionesCampana() {
  const pathname = usePathname();
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [vistoHasta, setVistoHasta] = useState<string | null | undefined>(undefined);
  const contenedor = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    const id = ++pedido.current;
    try {
      const res = await fetch("/api/admin/notificaciones", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NotificacionesRespuesta;
      if (id !== pedido.current) return;
      setVistoHasta((prev) => (prev === undefined ? leerVistoHasta() : prev));
      setEstado({ fase: "listo", items: Array.isArray(data.items) ? data.items : [] });
    } catch (error: unknown) {
      console.error("[NotificacionesCampana] cargar", error);
      // Un refresco en segundo plano que falla no borra lo que ya se ve.
      if (id === pedido.current) setEstado((prev) => (prev.fase === "listo" ? prev : { fase: "error" }));
    }
  }, []);

  useRefrescoNotificaciones(useCallback(() => void cargar(), [cargar]));

  const items = useMemo(() => (estado.fase === "listo" ? estado.items : []), [estado]);
  // Hasta leer el localStorage (después del montaje) no se muestra el contador: evita desajustes de hidratación.
  // Cerrar al cambiar de ruta: el panel queda abierto solo en la ruta donde se abrió.
  const abierto = abiertoEn !== null && abiertoEn === pathname;
  // Con el panel abierto no se muestra el contador; lo que llegue mientras tanto se marca visto al cerrar.
  const noVistas = abierto || vistoHasta === undefined ? 0 : contarNoVistas(items, vistoHasta);

  const marcarVisto = useCallback(() => {
    const ultima = fechaMasNueva(items);
    if (ultima && ultima !== vistoHasta) {
      guardarVistoHasta(ultima);
      setVistoHasta(ultima);
    }
  }, [items, vistoHasta]);

  const cerrar = useCallback(() => {
    setAbiertoEn(null);
    marcarVisto();
  }, [marcarVisto]);

  const alternar = () => {
    if (abierto) {
      cerrar();
      return;
    }
    setAbiertoEn(pathname);
    marcarVisto();
  };

  const reintentar = () => {
    setEstado({ fase: "cargando" });
    void cargar();
  };

  // Cerrar con Escape y con clic afuera.
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cerrar();
        boton.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) cerrar();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [abierto, cerrar]);

  const etiqueta = noVistas > 0 ? `Notificaciones: ${noVistas} sin ver` : "Notificaciones";

  return (
    <div ref={contenedor} className="relative">
      <button
        ref={boton}
        type="button"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-haspopup="true"
        aria-controls="panel-notificaciones"
        onClick={alternar}
        className={cn(
          "relative p-2.5 rounded-xl neumorphic-hover transition-colors",
          abierto ? "text-brand-orange" : "text-gray-500 hover:text-brand-orange",
        )}
      >
        <Bell size={18} aria-hidden />
        {noVistas > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4 text-center"
          >
            {noVistas > 9 ? "9+" : noVistas}
          </span>
        )}
      </button>

      {abierto && (
        <div
          id="panel-notificaciones"
          role="region"
          aria-label="Notificaciones"
          className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] neumorphic rounded-2xl p-2 bg-background"
        >
          <p className="px-2 pt-1 pb-2 text-[11px] font-bold uppercase tracking-widest text-gray-500">Novedades</p>
          <PanelContenido estado={estado} onReintentar={reintentar} />
        </div>
      )}
    </div>
  );
}

function PanelContenido({ estado, onReintentar }: { estado: Estado; onReintentar: () => void }) {
  if (estado.fase === "cargando") {
    return (
      <p role="status" className="px-2 py-6 text-center text-sm text-gray-500">
        Cargando…
      </p>
    );
  }
  if (estado.fase === "error") {
    return (
      <div role="alert" className="px-2 py-5 text-center">
        <p className="text-sm text-gray-600">No pudimos cargar las notificaciones</p>
        <button
          type="button"
          onClick={onReintentar}
          className="mt-3 px-3 py-1.5 rounded-xl neumorphic neumorphic-hover text-xs font-bold text-brand-orange"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (estado.items.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-gray-500">No hay novedades</p>;
  }
  const ahora = new Date();
  return (
    <ul className="max-h-96 overflow-y-auto custom-scrollbar flex flex-col gap-1">
      {estado.items.map((n) => {
        const Icono = ICONOS[n.tipo];
        return (
          <li key={n.id}>
            <Link href={n.href} className="flex gap-3 rounded-xl px-2 py-2 hover:bg-gray-100 transition-colors">
              <span className="mt-0.5 shrink-0 w-8 h-8 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange">
                <Icono size={15} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-800 truncate">{n.titulo}</span>
                <span className="block text-xs text-gray-500 truncate">{n.detalle}</span>
                <time dateTime={n.fecha} className="block text-[11px] text-gray-500 mt-0.5">
                  {haceCuanto(n.fecha, ahora)}
                </time>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
