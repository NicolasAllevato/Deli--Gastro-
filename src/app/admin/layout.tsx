import type { ReactNode } from "react";
import { createClient } from "@/utils/supabase/server";
import { NO_ACCESS, staffAccessOf } from "@/lib/auth/permissions";
import { isSuperOwnerEmail, superOwnerEmailFrom } from "@/lib/auth/owner-rules";
import { AdminShell } from "./_components/AdminShell";

/**
 * Layout del panel (servidor): resuelve quién es el usuario y qué secciones puede abrir, y se lo pasa
 * al marco del panel para armar el menú. Funciona con las tres sesiones (D1, Supabase y demo): donde no
 * hay `staff_role` el usuario es dueño. El proxy ya redirigió a quien no tiene acceso a la página; esto
 * solo evita mostrar enlaces que no puede usar. `superOwner` (el email de SUPER_OWNER_EMAIL, siendo dueño) habilita la
 * pestaña de eliminación de datos; la ruta y la capa de datos lo exigen igual.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const access = user ? staffAccessOf(user.app_metadata) : NO_ACCESS;
  const superOwner = !!user && access.staffRole === "admin" && isSuperOwnerEmail(user.email, superOwnerEmailFrom(process.env));
  return <AdminShell access={access} superOwner={superOwner}>{children}</AdminShell>;
}
