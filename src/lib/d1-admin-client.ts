import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createFakeClient, type DemoTransport } from "@/lib/demo/fake-client";
import type { QueryPlan } from "@/lib/demo/query";
import { executePlanInD1, type D1Plan } from "@/lib/data";

/**
 * Cliente "admin" con la forma de supabase-js que ejecuta en D1 (etapa 1 del corte, DATA_BACKEND=d1).
 * Reusa el constructor de consultas del modo demo; el motor (src/lib/data/plan-sql.ts) traduce cada
 * plan a SQL parametrizado sobre las tablas de la app. Equivale al service-role de hoy: la
 * autorización sigue en cada ruta. La parte de Auth (usuarios, sesiones) pasa a Better Auth en la etapa 3.
 */
export function createD1AdminClient(): SupabaseClient<Database> {
  const transport: DemoTransport = {
    execute: (plan: QueryPlan) => executePlanInD1(plan as unknown as D1Plan),
    async getUser() {
      return null;
    },
    async signIn() {
      return { error: { message: "Con D1 el ingreso es por Better Auth." } };
    },
    async signOut() {
      /* las sesiones son de Better Auth (etapa 3) */
    },
  };
  return createFakeClient(transport);
}
