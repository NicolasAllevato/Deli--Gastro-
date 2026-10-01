import type { User } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/auth/roles";

export const DEMO_PASSWORD = "demo1234";

export interface DemoAccount {
  role: UserRole;
  id: string;
  email: string;
  label: string;
  name: string;
  home: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    role: "admin",
    id: "00000000-0000-4000-8000-0000000000a1",
    email: "admin@deli-gastro.com",
    label: "Administrador",
    name: "Admin Central",
    home: "/admin/tablero",
  },
  {
    role: "cliente",
    id: "00000000-0000-4000-8000-0000000000c1",
    email: "cliente@deli-gastro.com",
    label: "Cliente",
    name: "Sofía Martínez",
    home: "/cliente",
  },
  {
    role: "repartidor",
    id: "00000000-0000-4000-8000-0000000000b1",
    email: "repartidor@deli-gastro.com",
    label: "Repartidor",
    name: "Diego Rojas",
    home: "/repartidor",
  },
] as const;

export function accountByRole(role: string | undefined | null): DemoAccount | null {
  return DEMO_ACCOUNTS.find((a) => a.role === role) ?? null;
}

export function accountByCredentials(email: string, password: string): DemoAccount | null {
  if (password !== DEMO_PASSWORD) return null;
  return DEMO_ACCOUNTS.find((a) => a.email === email.trim().toLowerCase()) ?? null;
}

/** Usuario con la misma forma mínima que `User` de Supabase Auth. */
export function toDemoUser(account: DemoAccount): User {
  return {
    id: account.id,
    email: account.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { role: account.role, provider: "demo" },
    user_metadata: { demo: true, name: account.name },
    created_at: "2026-01-01T00:00:00.000Z",
  } as User;
}
