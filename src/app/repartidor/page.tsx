export const dynamic = "force-dynamic";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { courierDisplayName } from "@/lib/auth/courier";
import { listOrders } from "@/lib/orders-server";
import CourierClient from "./CourierClient";

export default async function RepartidorPage() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const orders = await listOrders(createAdminClient(), { statuses: ["En Camino"] });

  return <CourierClient initialOrders={orders} courierName={user ? courierDisplayName(user) : "Repartidor"} />;
}
