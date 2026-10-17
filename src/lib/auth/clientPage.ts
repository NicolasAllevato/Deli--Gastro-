import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getClientByUserId } from "@/lib/orders-server";

/**
 * Para server components del portal cliente: devuelve el usuario autenticado y
 * su registro de `clients`, o redirige a /login. Todas las consultas de la
 * página deben filtrar por `client.id` devuelto acá.
 */
export async function requireClientPage() {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) redirect("/login");

  const db = createAdminClient();
  const client = await getClientByUserId(db, user.id);
  return { user, client, db };
}
