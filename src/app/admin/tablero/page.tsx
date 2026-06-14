export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/utils/supabase/admin";
import TableroClient from "./TableroClient";

export default async function AdminTableroPage() {
  const supabase = createAdminClient();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ data: orders }, { data: ventasData }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, client_id, status, items_desc, total, created_at")
      .neq("status", "Cancelado")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("orders")
      .select("total")
      .gte("created_at", today.toISOString())
      .neq("status", "Cancelado"),
  ]);

  const ventasHoy = ventasData?.reduce((sum, o) => sum + Number(o.total), 0) ?? 0;

  return <TableroClient initialOrders={orders ?? []} ventasHoy={ventasHoy} />;
}
