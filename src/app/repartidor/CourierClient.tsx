"use client";

import { useCallback, useEffect, useState } from "react";
import { Bike, CheckCircle2, CreditCard, MapPin, Phone, PackageCheck } from "lucide-react";
import { formatMoney, formatOrderId, minutesSince, parseItems } from "@/lib/orders";
import type { EnrichedOrder } from "@/lib/orders-server";

interface Props {
  initialOrders: EnrichedOrder[];
  courierName: string;
}

const POLL_MS = 5000;

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

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (id: string, body: { status: "Finalizados" } | { courier_name: string }) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
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

  const mine = orders.filter((o) => o.courier_name === courierName);
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
            <p className="text-[11px] text-gray-500 mt-0.5">En camino hace {minutesSince(order.updated_at)} min</p>
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
      </div>

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
