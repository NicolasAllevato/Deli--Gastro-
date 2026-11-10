import { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_ACCOUNTS } from "@/lib/demo/users";
import { approvedCourierNames } from "@/lib/courier-shifts";

const unique = (names: readonly string[]) => [...new Set(names)].sort((a, b) => a.localeCompare(b, "es"));

/**
 * Repartidores a los que se les puede asignar un pedido: los que el admin habilitó hoy (migración 029).
 * El nombre es el mismo `courierDisplayName` con que el repartidor pidió la habilitación, así el pedido
 * asignado le aparece como "suyo".
 */
export async function listCourierNames(): Promise<string[]> {
  if (isDemoMode()) {
    return DEMO_ACCOUNTS.filter((a) => a.role === "repartidor").map((a) => a.name);
  }
  return unique((await approvedCourierNames(createAdminClient())) ?? []);
}
