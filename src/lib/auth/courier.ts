import type { User } from "@supabase/supabase-js";

/**
 * Nombre visible del repartidor (queda en `orders.courier_name`). Sólo afecta
 * lo que se muestra: la autorización sale del rol en `app_metadata`.
 */
export function courierDisplayName(user: Pick<User, "email" | "user_metadata">): string {
  const name = user.user_metadata?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return user.email?.split("@")[0] ?? "Repartidor";
}
