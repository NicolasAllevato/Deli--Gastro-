import { notFound } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { formatMoney } from "@/lib/orders";
import DemoCheckout from "./DemoCheckout";

export const dynamic = "force-dynamic";

/** Simulador del checkout de Mercado Pago (solo modo demo): permite aprobar o rechazar un pago sin salir de la app. */
export default async function DemoMercadoPagoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isDemoMode()) notFound();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const { data: intent } = await createAdminClient().from("payment_intents").select("id, total, status").eq("id", id.data).maybeSingle();
  if (!intent) notFound();

  return <DemoCheckout intentId={intent.id} total={formatMoney(Number(intent.total))} status={intent.status} />;
}
