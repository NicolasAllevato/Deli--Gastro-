export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { z } from "zod";
import { requireClientPage } from "@/lib/auth/clientPage";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { minutesSince } from "@/lib/orders";
import OrderTracker, { type TrackedOrder } from "./OrderTracker";

export default async function PedidoSeguimientoPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const { client, db } = await requireClientPage();
  if (!client) notFound();

  const { data: order } = await db
    .from("orders")
    .select("*")
    .eq("id", id.data)
    .eq("client_id", client.id)
    .maybeSingle();
  if (!order) notFound();

  const [config, review] = await Promise.all([
    readConfig(db),
    db.from("reviews").select("id").eq("order_id", order.id).limit(1),
  ]);
  const cancelWindow = numberConfig(config, "cancelacion_min", 15);

  const initial: TrackedOrder = {
    id: order.id,
    status: order.status,
    items_desc: order.items_desc,
    total: Number(order.total),
    delivery_fee: Number(order.delivery_fee ?? 0),
    delivery_address: order.delivery_address ?? null,
    payment_method: order.payment_method ?? null,
    notes: order.notes ?? null,
    courier_name: order.courier_name ?? null,
    created_at: order.created_at,
  };

  return (
    <OrderTracker
      initial={initial}
      etaMinutes={numberConfig(config, "tiempo_entrega_min", 30)}
      canCancel={order.status === "Recibidos" && minutesSince(order.created_at) <= cancelWindow}
      cancelWindow={cancelWindow}
      reviewed={(review.data ?? []).length > 0}
    />
  );
}
