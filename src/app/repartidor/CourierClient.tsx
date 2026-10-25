"use client";

import { useCallback, useState } from "react";
import { Bike, CheckCircle2, CreditCard, Download, MapPin, MapPinOff, Navigation, Phone, PackageCheck, Smartphone } from "lucide-react";
import { COURIER_APK_URL, COURIER_APK_VERSION } from "@/lib/courier-app";
import { openNativeSettings } from "@/lib/native-location";
import { useCourierTracking, type TrackingState } from "@/lib/useCourierTracking";
import { formatMoney, formatOrderId, minutesSince, parseItems } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";
import { TOPIC_ALL_ORDERS } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

interface Props {
  initialOrders: EnrichedOrder[];
  courierName: string;
}

const DEMO_POLL_MS = 5000;

const TRACKING_COPY: Record<Exclude<TrackingState, "off">, { text: string; className: string }> = {
  starting: { text: "Activando tu ubicación…", className: "badge-yellow" },
  on: { text: "Compartiendo tu ubicación con el local", className: "badge-green" },
  denied: { text: "Activá el permiso de ubicación para que el local vea por dónde vas", className: "badge-red" },
  unavailable: { text: "No pudimos leer tu ubicación. Revisá el GPS.", className: "badge-red" },
};

const isAndroid = (): boolean => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

/** Desde el navegador no se toma la ubicación: se ofrece bajar la app Android, que la comparte en segundo plano. */
function DownloadAppCard() {
  const android = isAndroid();
  return (
    <section aria-labelledby="app-title" className="neumorphic rounded-2xl p-5 space-y-3">
      <h3 id="app-title" className="flex items-center gap-2 font-black text-gray-800">
        <Smartphone size={18} className="text-brand-orange" aria-hidden /> Bajá la app del repartidor
      </h3>
      <p className="text-sm text-gray-600">
        La ubicación se comparte solo desde la app: sigue funcionando con la pantalla bloqueada y el local ve en el mapa
        por dónde vas mientras tenés entregas.
      </p>
      {android ? (
        <>
          <a
            href={COURIER_APK_URL}
            download
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full btn-glow text-white font-black text-sm"
          >
            <Download size={16} aria-hidden /> Descargar app para Android (v{COURIER_APK_VERSION})
          </a>
          <ol className="text-xs text-gray-500 list-decimal pl-5 space-y-1">
            <li>Abrí el archivo descargado y aceptá &ldquo;Instalar apps desconocidas&rdquo; para el navegador.</li>
            <li>Si aparece un aviso de Play Protect, tocá &ldquo;Más detalles&rdquo; → &ldquo;Instalar de todas formas&rdquo;.</li>
            <li>En Samsung, si se bloquea, desactivá Ajustes → Seguridad → Bloqueador automático.</li>
            <li>Abrí la app, iniciá sesión y aceptá la ubicación &ldquo;Permitir todo el tiempo&rdquo;.</li>
          </ol>
        </>
      ) : (
        <p className="text-sm text-gray-500">Abrí esta página desde un teléfono Android para descargar la app.</p>
      )}
    </section>
  );
}

/** Dentro de la app, si el permiso de ubicación quedó denegado, se lleva a los ajustes para habilitarlo. */
function LocationDeniedCard() {
  return (
    <section aria-labelledby="loc-title" className="neumorphic rounded-2xl p-5 space-y-2 border border-red-200">
      <h3 id="loc-title" className="flex items-center gap-2 font-black text-gray-800">
        <MapPinOff size={18} className="text-red-500" aria-hidden /> La ubicación está bloqueada
      </h3>
      <p className="text-sm text-gray-600">
        El local no puede ver por dónde vas. En los ajustes de la app, entrá a Permisos → Ubicación y elegí
        &ldquo;Permitir todo el tiempo&rdquo;.
      </p>
      <button
        type="button"
        onClick={() => openNativeSettings()}
        className="w-full py-2.5 rounded-full neumorphic-inset text-brand-orange font-black text-sm"
      >
        Abrir ajustes de la app
      </button>
    </section>
  );
}

function TrackingBadge({ state }: { state: Exclude<TrackingState, "off"> }) {
  const { text, className } = TRACKING_COPY[state];
  return (
    <p role="status" className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${className}`}>
      <Navigation size={12} aria-hidden /> {text}
    </p>
  );
}

export default function CourierClient({ initialOrders, courierName }: Props) {
  const [orders, setOrders] = useState<EnrichedOrder[]>(initialOrders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (res.ok) setOrders((await res.json()) as EnrichedOrder[]);
    } catch {
      /* sin red: se reintenta en el próximo ciclo */
    }
  }, []);

  useLiveRefresh({ topic: TOPIC_ALL_ORDERS, refresh, demoPollMs: DEMO_POLL_MS });

  const mine = orders.filter((o) => o.courier_name === courierName);
  const { state: tracking, native, deliveredPoint: lastPoint } = useCourierTracking(mine.length > 0);

  const act = async (
    id: string,
    body: { status: "Finalizados" } | { courier_name: string } | { picked_up: true },
  ) => {
    setBusyId(id);
    setError(null);
    try {
      // Al entregar se guarda la última posición de la app: es el punto de entrega en el mapa del admin.
      const deliveredPoint = "status" in body ? lastPoint() : null;
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body, ...(deliveredPoint ? { delivered_point: deliveredPoint } : {}) }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "No se pudo actualizar la entrega.");
      }
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la entrega.");
    } finally {
      setBusyId(null);
    }
  };

  const available = orders.filter((o) => o.courier_name === null);
  const others = orders.filter((o) => o.courier_name !== null && o.courier_name !== courierName);

  const renderCard = (order: EnrichedOrder) => {
    const isMine = order.courier_name === courierName;
    const isFree = order.courier_name === null;
    const busy = busyId === order.id;
    const cash = order.payment_method === "Efectivo";

    return (
      <article key={order.id} className="neumorphic rounded-2xl p-5 space-y-4">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <h3 className="font-headline font-black text-base text-gray-800">
              {formatOrderId(order.id)} <span className="font-medium text-gray-500">· {order.client_name}</span>
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">En camino hace {minutesSince(order.ready_at ?? order.updated_at)} min</p>
          </div>
          <span className="font-headline font-black text-brand-orange shrink-0">{formatMoney(order.total)}</span>
        </div>

        <ul className="text-sm text-gray-600 space-y-0.5">
          {parseItems(order.items_desc).map((l) => (
            <li key={`${l.qty}-${l.name}`}>{l.qty}x {l.name}</li>
          ))}
        </ul>

        {order.delivery_address && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <MapPin size={16} className="shrink-0 mt-0.5" aria-hidden />
            {order.delivery_address}
          </a>
        )}
        {order.client_phone && (
          <a href={`tel:${order.client_phone.replace(/\s/g, "")}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-brand-orange">
            <Phone size={14} aria-hidden /> {order.client_phone}
          </a>
        )}
        {order.payment_method && (
          <p className={`flex items-center gap-2 text-sm font-bold ${cash ? "text-red-600" : "text-gray-500"}`}>
            <CreditCard size={14} aria-hidden />
            {cash ? `Cobrar ${formatMoney(order.total)} en efectivo` : `Pagado con ${order.payment_method}`}
          </p>
        )}
        {order.notes && <p className="text-xs text-gray-500 italic">&ldquo;{order.notes}&rdquo;</p>}

        {isFree && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(order.id, { courier_name: courierName })}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full neumorphic-inset text-brand-orange font-black text-sm disabled:opacity-50"
          >
            <Bike size={16} aria-hidden /> Tomar pedido
          </button>
        )}
        {isMine && !order.picked_up_at && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(order.id, { picked_up: true })}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full neumorphic-inset text-brand-orange font-black text-sm disabled:opacity-50"
          >
            <Bike size={16} aria-hidden /> Salí con el pedido
          </button>
        )}
        {isMine && order.picked_up_at && (
          <p className="text-xs font-bold text-gray-500">Saliste hace {minutesSince(order.picked_up_at)} min</p>
        )}
        {isMine && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(order.id, { status: "Finalizados" })}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full btn-glow text-white font-black text-sm disabled:opacity-50"
          >
            <CheckCircle2 size={16} aria-hidden /> Marcar como entregado
          </button>
        )}
        {!isFree && !isMine && (
          <p className="text-xs font-bold text-gray-500">Asignado a {order.courier_name}</p>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-headline text-2xl font-black text-gray-800">Mis entregas</h2>
        <p className="text-gray-500 text-sm mt-1">Pedidos que ya salieron de cocina</p>
        {tracking !== "off" && <TrackingBadge state={tracking} />}
      </div>

      {native === false && <DownloadAppCard />}
      {native === true && tracking === "denied" && <LocationDeniedCard />}

      {error && (
        <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>
      )}

      <section aria-labelledby="mine-title" className="space-y-3">
        <h3 id="mine-title" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
          Asignados a mí ({mine.length})
        </h3>
        {mine.length === 0 ? (
          <div className="neumorphic-inset rounded-2xl p-6 text-center text-sm text-gray-500">
            No tenés entregas asignadas. Tomá un pedido de la lista.
          </div>
        ) : (
          mine.map(renderCard)
        )}
      </section>

      <section aria-labelledby="free-title" className="space-y-3">
        <h3 id="free-title" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
          Disponibles ({available.length})
        </h3>
        {available.length === 0 ? (
          <div className="neumorphic-inset rounded-2xl p-6 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
            <PackageCheck size={22} className="text-gray-300" aria-hidden />
            No hay pedidos esperando repartidor.
          </div>
        ) : (
          available.map(renderCard)
        )}
      </section>

      {others.length > 0 && (
        <section aria-labelledby="others-title" className="space-y-3">
          <h3 id="others-title" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
            Con otros repartidores ({others.length})
          </h3>
          {others.map(renderCard)}
        </section>
      )}
    </div>
  );
}
