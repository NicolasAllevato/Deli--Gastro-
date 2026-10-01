export const dynamic = "force-dynamic";

import { requireClientPage } from "@/lib/auth/clientPage";
import { numberConfig, readConfig } from "@/lib/orders-server";
import CheckoutClient from "./CheckoutClient";

export default async function CarritoPage() {
  const { client, db } = await requireClientPage();
  const config = await readConfig(db);

  return (
    <CheckoutClient
      clientAddress={client?.address ?? null}
      costoPorKm={numberConfig(config, "costo_por_km", 150)}
      radioKm={numberConfig(config, "radio_delivery_km", 8)}
      paused={config.modo_pausa === true || config.tienda_activa === false}
    />
  );
}
