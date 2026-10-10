export const dynamic = "force-dynamic";

import { requireClientPage } from "@/lib/auth/clientPage";
import { isDemoMode } from "@/lib/demo/mode";
import { readConfig } from "@/lib/orders-server";
import CheckoutClient from "./CheckoutClient";

export default async function CarritoPage() {
  const { client, db } = await requireClientPage();
  const config = await readConfig(db);

  return (
    <CheckoutClient
      clientAddress={client?.address ?? null}
      paused={config.modo_pausa === true || config.tienda_activa === false}
      showSamples={isDemoMode()}
    />
  );
}
