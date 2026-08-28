import type { User } from "@supabase/supabase-js";

/**
 * Roles soportados por la aplicación.
 *
 * El rol se guarda en `app_metadata.role` (NO en `user_metadata`).
 * `app_metadata` sólo puede ser escrito por el service role de Supabase
 * (server-side, ej. `supabase.auth.admin.updateUserById`), por lo que un
 * usuario autenticado no puede auto-otorgarse el rol "admin" llamando a
 * `supabase.auth.updateUser()` desde el cliente — a diferencia de
 * `user_metadata`, que sí es editable por el propio usuario.
 */
export type UserRole = "admin" | "cliente";

const DEFAULT_ROLE: UserRole = "cliente";

/**
 * Extrae el rol de un usuario de Supabase Auth de forma segura.
 * Sólo confía en `app_metadata` (controlado por el server). Nunca lee
 * `user_metadata`, que el propio usuario puede modificar.
 */
export function getUserRole(user: Pick<User, "app_metadata"> | null | undefined): UserRole {
  const rawRole = user?.app_metadata?.role;
  return rawRole === "admin" ? "admin" : DEFAULT_ROLE;
}

export function isAdmin(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return getUserRole(user) === "admin";
}
