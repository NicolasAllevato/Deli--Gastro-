export const dynamic = "force-dynamic";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { courierDisplayName } from "@/lib/auth/courier";
import { requestShift } from "@/lib/courier-shifts";
import type { ShiftStatus } from "@/lib/courier-shift-day";
import { listOrders } from "@/lib/orders-server";
import CourierClient from "./CourierClient";

export default async function RepartidorPage() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const db = createAdminClient();
  const courierName = user ? courierDisplayName(user) : "Repartidor";
  // Abrir la sesión pide la habilitación del día; el admin la acepta desde su panel.
  let shift: ShiftStatus = "pending";
  if (user) {
    try {
      shift = await requestShift(db, user.id, courierName);
    } catch (error: unknown) {
      console.error("[repartidor] habilitación del día", error);
    }
  }
  const orders = await listOrders(db, { statuses: ["En Camino"] });

  return <CourierClient initialOrders={orders} courierName={courierName} shift={shift} />;
}
