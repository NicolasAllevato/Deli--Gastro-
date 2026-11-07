export const dynamic = "force-dynamic";

import { createAdminClient } from "@/utils/supabase/admin";
import { listOrders, numberConfig, readConfig } from "@/lib/orders-server";
import TableroClient from "./TableroClient";

export default async function AdminTableroPage() {
  const db = createAdminClient();
  const [orders, config] = await Promise.all([listOrders(db, { excludeCancelled: true }), readConfig(db)]);
  return <TableroClient initialOrders={orders} targetMinutes={numberConfig(config, "tiempo_entrega_min", 30)} />;
}
