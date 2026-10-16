export const dynamic = "force-dynamic";

import { requireClientPage } from "@/lib/auth/clientPage";
import { isDemoMode } from "@/lib/demo/mode";
import { readConfig } from "@/lib/orders-server";
import { isOnlinePaymentEnabled } from "@/lib/payments/gateway";
import CheckoutClient from "./CheckoutClient";

export default async function CarritoPage() {
  const { client, db } = await requireClientPage();
  const config = await readConfig(db);

  // Categoría de cada producto: el carrito muestra el canje con la misma regla que valida el servidor.
  const [{ data: products }, { data: categories }] = await Promise.all([
    db.from("products").select("id, category_id"),
    db.from("categories").select("id, name"),
  ]);
  const nameById = new Map((categories ?? []).map((c) => [String(c.id), String(c.name)]));
  const productCategories: Record<string, string> = {};
  for (const p of products ?? []) {
    const name = p.category_id ? nameById.get(String(p.category_id)) : undefined;
    if (name) productCategories[String(p.id)] = name;
  }

  return (
    <CheckoutClient
      clientAddress={client?.address ?? null}
      paused={config.modo_pausa === true || config.tienda_activa === false}
      showSamples={isDemoMode()}
      points={client?.total_points ?? 0}
      productCategories={productCategories}
      onlinePayments={isOnlinePaymentEnabled()}
    />
  );
}
