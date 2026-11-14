import type { QueryResult } from "@/lib/demo/query";

/**
 * Los clientes "de sesión" con D1 (servidor y navegador) NO consultan tablas: no hay RLS en
 * D1, así que un plan ejecutado con ellos correría con privilegios de admin. Toda lectura o
 * escritura va por createAdminClient() en una ruta que antes filtra por el usuario de la sesión.
 */
export const NO_TABLES_ERROR = "El cliente de sesión no accede a tablas: usá una ruta del servidor.";

export async function rejectTableAccess(): Promise<QueryResult> {
  return { data: null, error: { message: NO_TABLES_ERROR, code: "42501" }, count: null } as unknown as QueryResult;
}
