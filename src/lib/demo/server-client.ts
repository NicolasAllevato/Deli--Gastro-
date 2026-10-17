import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DEMO_COOKIE } from "@/lib/demo/mode";
import { accountByRole, toDemoUser } from "@/lib/demo/users";
import { createFakeClient, type DemoTransport } from "@/lib/demo/fake-client";
import { executePlan } from "@/lib/demo/query";
import { getStore } from "@/lib/demo/store";

/** Cliente demo para el servidor: ejecuta directo contra el store en memoria. */
export async function createDemoServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  const transport: DemoTransport = {
    async execute(plan) {
      return executePlan(plan, getStore());
    },
    async getUser() {
      const account = accountByRole(cookieStore.get(DEMO_COOKIE)?.value);
      return account ? toDemoUser(account) : null;
    },
    async signIn() {
      return { error: { message: "Usá /api/demo/session para iniciar sesión." } };
    },
    async signOut() {
      /* la cookie se borra en /api/demo/session */
    },
  };

  return createFakeClient(transport);
}

/** Cliente demo con permisos totales (equivale al service role). */
export function createDemoAdminClient(): SupabaseClient<Database> {
  const transport: DemoTransport = {
    async execute(plan) {
      return executePlan(plan, getStore());
    },
    async getUser() {
      return null;
    },
    async signIn() {
      return { error: { message: "No disponible en el cliente admin." } };
    },
    async signOut() {
      /* noop */
    },
  };

  return createFakeClient(transport);
}
