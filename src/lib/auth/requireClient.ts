import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireRole, isAuthorizationError, type AuthorizedRequest } from "@/lib/auth/requireRole";
import { getClientByUserId } from "@/lib/orders-server";

type ClientRow = NonNullable<Awaited<ReturnType<typeof getClientByUserId>>>;

export interface AuthorizedClient extends AuthorizedRequest {
  client: ClientRow;
}

export type ClientAuthResult = AuthorizedClient | { error: NextResponse };

/**
 * Exige sesión con rol "cliente" y resuelve su registro en `clients`.
 * Todo endpoint del portal cliente parte de acá, así cada consulta queda
 * acotada al `client.id` del usuario autenticado (nunca a un id del body).
 */
export async function requireClient(req?: Request): Promise<ClientAuthResult> {
  const auth = await requireRole("cliente", req);
  if (isAuthorizationError(auth)) return auth;

  const client = await getClientByUserId(createAdminClient(), auth.user.id);
  if (!client) {
    return { error: NextResponse.json({ error: "Cliente no encontrado." }, { status: 403 }) };
  }

  return { ...auth, client };
}
