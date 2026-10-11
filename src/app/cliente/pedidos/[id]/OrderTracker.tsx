"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Bike, CheckCircle2, ChefHat, CircleDot, ClipboardCheck, MapPin, Star, Wallet, XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/lib/buttonClasses";
import {
  TRACKING_STEPS, formatMoney, formatOrderId, isActiveStatus, minutesSince, parseItems,
} from "@/lib/orders";
import type { OrderStatus } from "@/types/database";
import { orderTopic } from "@/lib/live-refresh";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

export interface TrackedOrder {
  id: string;
  status: OrderStatus;
  items_desc: string;
  total: number;
  delivery_fee: number;
  delivery_address: string | null;
  payment_method: string | null;
  notes: string | null;
  courier_name: string | null;
  created_at: string;
}

interface Props {
  initial: TrackedOrder;
  etaMinutes: number;
  canCancel: boolean;
  cancelWindow: number;
  reviewed: boolean;
}

interface TrackingResponse {
  order: TrackedOrder;
  etaMinutes: number;
  canCancel: boolean;
  cancelWindow: number;
  reviewed: boolean;
}

const STEP_ICON: Record<string, LucideIcon> = {
  Recibidos: ClipboardCheck,
  "En Preparación": ChefHat,
  "En Camino": Bike,
  Finalizados: CheckCircle2,
};

const DEMO_POLL_MS = 4000;
const CLOCK_TICK_MS = 15_000;

export default function OrderTracker(props: Props) {
  const [order, setOrder] = useState(props.initial);
  const [etaMinutes, setEtaMinutes] = useState(props.etaMinutes);
  const [canCancel, setCanCancel] = useState(props.canCancel);
  const [reviewed, setReviewed] = useState(props.reviewed);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/orders/${props.initial.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as TrackingResponse;
      setOrder(json.order);
      setEtaMinutes(json.etaMinutes);
      setCanCancel(json.canCancel);
      setReviewed(json.reviewed);
    } catch {
      /* sin red: se reintenta en el próximo ciclo */
    }
  }, [props.initial.id]);

  const active = isActiveStatus(order.status);

  // Mientras el pedido siga activo, un aviso en tiempo real dispara la consulta del estado.
  useLiveRefresh({ topic: orderTopic(props.initial.id), refresh, demoPollMs: DEMO_POLL_MS, enabled: active });

  // La cuenta regresiva del ETA solo necesita avanzar de a poco.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  const cancel = async () => {
    if (!confirm("¿Querés cancelar este pedido?")) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cancelar.");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar.");
    } finally {
      setCancelling(false);
    }
  };

  const cancelled = order.status === "Cancelado";
  const currentIndex = TRACKING_STEPS.findIndex((s) => s.status === order.status);
  const remaining = Math.max(5, etaMinutes - minutesSince(order.created_at, now));
  const lines = parseItems(order.items_desc);

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto pb-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/cliente/pedidos" aria-label="Volver a mis pedidos" className={buttonClasses("icon", "sm")}>
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h2 className="font-headline text-2xl font-black text-gray-800">Pedido {formatOrderId(order.id)}</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            {cancelled ? "Cancelado" : isActiveStatus(order.status) ? `Llega en unos ${remaining} min` : "Entregado"}
          </p>
        </div>
      </div>

      {cancelled ? (
        <div role="status" className="neumorphic rounded-2xl p-6 flex items-center gap-4 text-red-600">
          <XCircle size={28} aria-hidden />
          <p className="font-bold text-sm">Este pedido fue cancelado.</p>
        </div>
      ) : (
        <ol aria-label="Estado del pedido" className="neumorphic rounded-2xl p-5 space-y-5">
          {TRACKING_STEPS.map((step, i) => {
            const done = i < currentIndex || order.status === "Finalizados";
            const current = i === currentIndex && order.status !== "Finalizados";
            const Icon = STEP_ICON[step.status] ?? CircleDot;
            return (
              <li key={step.status} aria-current={current ? "step" : undefined} className="flex items-start gap-4">
                <span
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all",
                    done && "bg-brand-orange text-white shadow-[0_3px_8px_rgba(107,124,69,0.3)]",
                    current && "neumorphic-inset text-brand-orange ring-2 ring-brand-orange/40 animate-pulse",
                    !done && !current && "neumorphic-inset text-gray-300",
                  )}
                >
                  <Icon size={18} aria-hidden />
                </span>
                <div className="pt-1.5">
                  <p className={cn("font-bold text-sm", done || current ? "text-gray-800" : "text-gray-400")}>{step.label}</p>
                  {(current || (done && i === TRACKING_STEPS.length - 1)) && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {step.status === "En Camino" && order.courier_name
                        ? `${order.courier_name} lleva tu pedido`
                        : step.hint}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section className="neumorphic rounded-2xl p-5 space-y-4">
        <h3 className="font-headline font-black text-sm text-gray-800 uppercase tracking-widest">Detalle</h3>
        <ul className="space-y-2 text-sm text-gray-600">
          {lines.map((l) => (
            <li key={`${l.qty}-${l.name}`} className="flex justify-between">
              <span>{l.qty}x {l.name}</span>
            </li>
          ))}
        </ul>
        <div className="pt-3 border-t border-gray-200/60 space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600"><span>Envío</span><span>{formatMoney(order.delivery_fee)}</span></div>
          <div className="flex justify-between font-black text-gray-800"><span>Total</span><span className="text-brand-orange">{formatMoney(order.total)}</span></div>
        </div>
        {order.delivery_address && (
          <p className="flex items-start gap-2 text-xs text-gray-500"><MapPin size={14} className="shrink-0 mt-0.5" aria-hidden />{order.delivery_address}</p>
        )}
        {order.payment_method && (
          <p className="flex items-center gap-2 text-xs text-gray-500"><Wallet size={14} aria-hidden />{order.payment_method}</p>
        )}
        {order.notes && <p className="text-xs text-gray-500 italic">&ldquo;{order.notes}&rdquo;</p>}
      </section>

      {error && (
        <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>
      )}

      {canCancel && (
        <button
          type="button"
          onClick={cancel}
          disabled={cancelling}
          className="w-full py-3.5 rounded-full neumorphic text-red-500 font-black text-sm hover:text-red-600 disabled:opacity-50"
        >
          {cancelling ? "Cancelando..." : "Cancelar pedido"}
        </button>
      )}
      {order.status === "Recibidos" && !canCancel && (
        <p className="text-[11px] text-gray-500 text-center">
          Ya pasó la ventana de {props.cancelWindow} min para cancelar desde la app.
        </p>
      )}

      {order.status === "Finalizados" && (
        reviewed ? (
          <p className="flex items-center justify-center gap-2 text-sm font-bold text-gray-500">
            <Star size={16} className="fill-yellow-400 text-yellow-400" aria-hidden /> Ya calificaste este pedido. ¡Gracias!
          </p>
        ) : (
          <Link href={`/cliente/resenas/${order.id}`} className={cn("w-full", buttonClasses("primary", "lg"))}>
            <Star size={16} aria-hidden /> Calificar pedido
          </Link>
        )
      )}
    </div>
  );
}
