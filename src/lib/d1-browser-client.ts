import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createFakeClient, type DemoTransport } from "@/lib/demo/fake-client";

/**
 * Cliente del navegador con DATA_BACKEND=d1 (etapa 3): solo sesión, contra Better Auth en
 * /api/auth. Los datos se piden a las rutas /api de la app (nunca hubo lecturas directas a
 * tablas desde el navegador). Lo que devuelve getUser es para mostrar: la autorización la
 * decide siempre el servidor.
 */
export function createD1BrowserClient(): SupabaseClient<Database> {
  const post = (path: string, body: unknown) =>
    fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });

  const transport: DemoTransport = {
    async execute() {
      return { data: null, error: { message: "Con D1 el navegador no consulta tablas directo." } } as never;
    },
    async getUser() {
      const res = await fetch("/api/auth/get-session", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { user?: { id: string; email: string; name?: string; role?: string } } | null;
      const u = json?.user;
      if (!u) return null;
      return {
        id: u.id,
        email: u.email,
        app_metadata: { role: u.role },
        user_metadata: u.name ? { name: u.name } : {},
        aud: "authenticated",
        created_at: "",
      } as unknown as User;
    },
    async signIn(email, password) {
      const res = await post("/sign-in/email", { email, password });
      return res.ok ? { error: null } : { error: { message: "Credenciales inválidas" } };
    },
    async signOut() {
      await post("/sign-out", {});
    },
  };
  return createFakeClient(transport);
}
