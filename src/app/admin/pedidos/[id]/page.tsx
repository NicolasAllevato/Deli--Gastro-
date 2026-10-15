export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, User, MapPin, Receipt, AlertTriangle, Phone, Bike, CreditCard, Star, Timer } from "lucide-react";
import { createAdminClient } from "@/utils/supabase/admin";
import { enrichOrders } from "@/lib/orders-server";
import { computeDurations, type TrackingDurations } from "@/lib/tracking";
import { formatMoney, formatOrderId, parseItems } from "@/lib/orders";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/lib/buttonClasses";

const ESTADO_TONE: Record<string, "green" | "red" | "yellow" | "blue" | "orange"> = {
  Finalizados:      "green",
  Cancelado:        "red",
  "En Preparación": "yellow",
  Recibidos:        "blue",
  "En Camino":      "orange",
};

const DURATION_LABELS: ReadonlyArray<{ key: keyof TrackingDurations; label: string }> = [
  { key: "kitchen", label: "Cocina" },
  { key: "dispatchWait", label: "Espera de despacho" },
  { key: "route", label: "En ruta" },
  { key: "total", label: "Total" },
];

const EVENT_LABELS: Record<string, string> = {
  picked_up: "El repartidor salió con el pedido",
  assigned: "Repartidor asignado",
};

/** Reseñas de 3 estrellas o menos abren un ticket de atención interna. */
const TICKET_MAX_RATING = 3;

export default async function PedidoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const db = createAdminClient();
  const { data: row } = await db.from("orders").select("*").eq("id", id.data).maybeSingle();
  if (!row) notFound();

  const [[pedido], reviewRes, clientRes, eventsRes] = await Promise.all([
    enrichOrders(db, [row]),
    db.from("reviews").select("rating, feedback, created_at").eq("order_id", row.id).limit(1),
    row.client_id
      ? db.from("clients").select("address").eq("id", row.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("order_events").select("event, actor, detail, created_at").eq("order_id", row.id).order("created_at", { ascending: true }),
  ]);
  if (!pedido) notFound();

  const durations = computeDurations(pedido);
  const events = eventsRes.data ?? [];

  const review = reviewRes.data?.[0];
  const hasTicket = review !== undefined && review.rating <= TICKET_MAX_RATING;
  const lines = parseItems(pedido.items_desc);
  const subtotal = pedido.total - pedido.delivery_fee;
  const address = pedido.delivery_address ?? clientRes.data?.address ?? "Sin dirección registrada";

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">

      {/* Cabecera */}
      <div className="flex items-center gap-4">
        <Link
          href="/admin/pedidos"
          aria-label="Volver a pedidos"
          className={buttonClasses("icon", "sm")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Pedido {formatOrderId(pedido.id)}</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            {new Date(pedido.created_at).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <div className="ml-auto">
          <Badge tone={ESTADO_TONE[pedido.status] ?? "blue"}>{pedido.status}</Badge>
        </div>
      </div>

      {/* Ticket interno */}
      {hasTicket && (
        <div className="neumorphic p-5 rounded-2xl border border-orange-300/60 flex gap-4 items-start bg-orange-50/50">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-orange-800 text-sm">Ticket de Atención Interna</h3>
            <p className="text-orange-700 mt-1 text-sm flex items-center gap-1">
              Calificación: {review.rating} <Star className="w-3.5 h-3.5 fill-orange-400 text-orange-400" aria-hidden />
            </p>
            {review.feedback && <p className="text-orange-700 mt-1 text-sm">{review.feedback}</p>}
          </div>
        </div>
      )}
      {review && !hasTicket && (
        <p className="flex items-center gap-2 text-sm font-bold text-gray-500">
          <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" aria-hidden /> El cliente calificó este pedido con {review.rating}.
        </p>
      )}

      {/* Cards de info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Cliente */}
        <div className="neumorphic p-5 rounded-2xl">
          <div className="flex items-center gap-2 mb-4 text-gray-700">
            <User className="w-4 h-4" />
            <h2 className="font-headline font-bold text-sm uppercase tracking-widest">Cliente</h2>
          </div>
          <div className="space-y-3 text-sm text-gray-600">
            <p><span className="font-bold text-gray-700">Nombre:</span> {pedido.client_name}</p>
            {pedido.client_phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span>{pedido.client_phone}</span>
              </div>
            )}
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <span>{address}</span>
            </div>
            {pedido.payment_method && (
              <div className="flex items-center gap-2">
                <CreditCard className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span>{pedido.payment_method}</span>
              </div>
            )}
            {pedido.courier_name && (
              <div className="flex items-center gap-2">
                <Bike className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span>Repartidor: {pedido.courier_name}</span>
              </div>
            )}
            {pedido.notes && <p className="italic text-gray-500">&ldquo;{pedido.notes}&rdquo;</p>}
          </div>
        </div>

        {/* Detalle de items */}
        <div className="neumorphic p-5 rounded-2xl">
          <div className="flex items-center gap-2 mb-4 text-gray-700">
            <Receipt className="w-4 h-4" />
            <h2 className="font-headline font-bold text-sm uppercase tracking-widest">Detalle</h2>
          </div>
          <ul className="space-y-2.5 mb-5">
            {lines.map((item) => (
              <li key={`${item.qty}-${item.name}`} className="flex justify-between text-sm text-gray-600">
                <span>{item.qty}x {item.name}</span>
              </li>
            ))}
          </ul>
          <div className="pt-3.5 border-t border-gray-200 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600"><span>Productos</span><span>{formatMoney(subtotal)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Envío</span><span>{formatMoney(pedido.delivery_fee)}</span></div>
            <div className="flex justify-between items-center pt-1.5">
              <span className="font-bold text-sm text-gray-800">Total</span>
              <span className="font-black text-base text-brand-orange">{formatMoney(pedido.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tiempos */}
      <div className="neumorphic p-5 rounded-2xl">
        <div className="flex items-center gap-2 mb-4 text-gray-700">
          <Timer className="w-4 h-4" />
          <h2 className="font-headline font-bold text-sm uppercase tracking-widest">Tiempos</h2>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {DURATION_LABELS.map(({ key, label }) => (
            <div key={key} className="neumorphic-inset rounded-xl p-3">
              <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{label}</dt>
              <dd className="font-headline font-black text-lg text-gray-800 mt-1">
                {durations[key] === null ? "—" : `${durations[key]} min`}
              </dd>
            </div>
          ))}
        </dl>
        {events.length > 0 && (
          <ol className="mt-5 space-y-1.5 text-xs text-gray-600">
            {events.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex gap-3">
                <time dateTime={e.created_at} className="font-bold text-gray-500 w-14 shrink-0">
                  {new Date(e.created_at).toLocaleTimeString("es-AR", { timeStyle: "short" })}
                </time>
                <span>
                  {EVENT_LABELS[e.event] ?? e.event}
                  {e.detail ? ` · ${e.detail}` : ""}
                  {e.actor ? ` (${e.actor})` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
