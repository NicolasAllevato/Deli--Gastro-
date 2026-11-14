import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/types/database";
import { createFakeClient, type DemoTransport } from "@/lib/demo/fake-client";
import { sessionUser } from "@/lib/data";
import { rejectTableAccess } from "@/lib/session-no-tables";

/**
 * Cliente "de sesión" del servidor con DATA_BACKEND=d1 (etapa 3). `auth.getUser()` lee la
 * cookie de Better Auth y devuelve el usuario con forma de Supabase (rol en app_metadata),
 * así requireAuth, el proxy y las páginas no cambian. El ingreso y la salida van por
 * /api/auth (Better Auth); acá no se abren sesiones.
 */
export function createD1SessionClient(): SupabaseClient<Database> {
  const transport: DemoTransport = {
    // Sin RLS en D1: este cliente nunca ejecuta planes (ver session-no-tables.ts).
    execute: rejectTableAccess,
    async getUser() {
      return (await sessionUser(await headers())) as unknown as User | null;
    },
    async signIn() {
      return { error: { message: "El ingreso es por /api/auth." } };
    },
    async signOut() {
      /* la salida es POST /api/auth/sign-out desde el navegador */
    },
  };
  return createFakeClient(transport);
}
