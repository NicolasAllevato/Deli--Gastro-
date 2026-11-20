import type { ReactNode } from "react";
import { createClient } from "@/utils/supabase/server";
import { NO_ACCESS, staffAccessOf } from "@/lib/auth/permissions";
import { AdminShell } from "./_components/AdminShell";

/**
 * Layout del panel (servidor): resuelve quién es el usuario y qué secciones puede abrir, y se lo pasa
 * al marco del panel para armar el menú. Funciona con las tres sesiones (D1, Supabase y demo): donde no
 * hay `staff_role` el usuario es dueño. El proxy ya redirigió a quien no tiene acceso a la página; esto
 * solo evita mostrar enlaces que no puede usar.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const access = user ? staffAccessOf(user.app_metadata) : NO_ACCESS;
  return <AdminShell access={access}>{children}</AdminShell>;
}
