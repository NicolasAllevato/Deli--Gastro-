export const dynamic = "force-dynamic";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { courierDisplayName } from "@/lib/auth/courier";
import { requestShift } from "@/lib/courier-shifts";
import type { ShiftStatus } from "@/lib/courier-shift-day";
import { listOrders } from "@/lib/orders-server";
import { courierMaySelfAssign } from "@/lib/courier-assign";
import { getAssignMode } from "@/lib/courier-assign-server";
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
  const [onTheWay, mode] = await Promise.all([listOrders(db, { statuses: ["En Camino"] }), getAssignMode(db)]);
  const selfAssign = courierMaySelfAssign(mode);
  // Fuera del modo libre solo ve lo suyo (igual que GET /api/orders).
  const orders = selfAssign ? onTheWay : onTheWay.filter((o) => o.courier_name === courierName);

  return <CourierClient initialOrders={orders} courierName={courierName} shift={shift} selfAssign={selfAssign} />;
}
