export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireClientPage } from "@/lib/auth/clientPage";
import { getIntentForClient } from "@/lib/payments/intents";
import PaymentStatus from "./PaymentStatus";

export default async function PagoPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const { client, db } = await requireClientPage();
  if (!client) notFound();

  const intent = await getIntentForClient(db, id.data, client.id);
  if (!intent) notFound();
  if (intent.status === "approved" && intent.orderId) redirect(`/cliente/pedidos/${intent.orderId}`);

  return <PaymentStatus initial={intent} />;
}
