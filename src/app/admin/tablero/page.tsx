export const dynamic = "force-dynamic";

import { createAdminClient } from "@/utils/supabase/admin";
import { listOrders } from "@/lib/orders-server";
import TableroClient from "./TableroClient";

export default async function AdminTableroPage() {
  const orders = await listOrders(createAdminClient(), { excludeCancelled: true });
  return <TableroClient initialOrders={orders} />;
}
