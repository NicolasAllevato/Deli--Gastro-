import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createFakeClient, type DemoTransport } from "@/lib/demo/fake-client";
import type { QueryResult } from "@/lib/demo/query";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** Cliente demo para el navegador: delega todo en las rutas /api/demo/*. */
export function createDemoBrowserClient(): SupabaseClient<Database> {
  const transport: DemoTransport = {
    execute: (plan) => postJson<QueryResult>("/api/demo/query", plan),
    async getUser() {
      const res = await fetch("/api/demo/session", { cache: "no-store" });
      const json = (await res.json()) as { user: User | null };
      return json.user;
    },
    async signIn(email, password) {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return res.ok ? { error: null } : { error: { message: "Credenciales inválidas" } };
    },
    async signOut() {
      await fetch("/api/demo/session", { method: "DELETE" });
    },
  };

  return createFakeClient(transport);
}
