import { createAdminClient } from "@/utils/supabase/admin";
import { courierDisplayName } from "@/lib/auth/courier";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_ACCOUNTS } from "@/lib/demo/users";

type Db = ReturnType<typeof createAdminClient>;

const MAX_USERS = 200;
const RECENT_ORDERS = 200;

const unique = (names: readonly string[]) => [...new Set(names)].sort((a, b) => a.localeCompare(b, "es"));

/**
 * Respaldo si la Admin API de Auth falla (ya pasó en este proyecto): los repartidores
 * que figuran en pedidos recientes. Menos completo, pero mantiene usable el selector.
 */
async function namesFromRecentOrders(db: Db): Promise<string[]> {
  const { data } = await db
    .from("orders")
    .select("courier_name")
    .not("courier_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(RECENT_ORDERS);
  return unique((data ?? []).map((o) => o.courier_name).filter((n): n is string => Boolean(n)));
}

/**
 * Nombres de los repartidores activos: las cuentas con `app_metadata.role = 'repartidor'`.
 * Se usa el mismo `courierDisplayName` que el portal del repartidor, así el nombre que
 * asigna el admin coincide con el que el repartidor ve como "suyo".
 */
export async function listCourierNames(): Promise<string[]> {
  if (isDemoMode()) {
    return DEMO_ACCOUNTS.filter((a) => a.role === "repartidor").map((a) => a.name);
  }

  const db = createAdminClient();
  // Los dados de alta con PIN en el admin (tabla couriers) siempre están, aunque falle la Admin API.
  const { data: rows } = await db.from("couriers").select("name").eq("active", true);
  const withPin = (rows ?? []).map((r) => r.name);

  const { data, error } = await db.auth.admin.listUsers({ perPage: MAX_USERS });
  if (error) return unique([...withPin, ...(await namesFromRecentOrders(db))]);

  return unique([
    ...withPin,
    ...data.users
      .filter((u) => u.app_metadata?.role === "repartidor" && !u.banned_until)
      .map((u) => courierDisplayName(u)),
  ]);
}
