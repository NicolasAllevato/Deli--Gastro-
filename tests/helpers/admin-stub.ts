/** Sustituto de `@/utils/supabase/admin` en los tests: las funciones reciben la base por parámetro. */
export function createAdminClient(): never {
  throw new Error("createAdminClient no está disponible en los tests: inyectá la base.");
}
