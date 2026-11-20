import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { staffAccessOf } from "@/lib/auth/permissions";
import { isSuperOwnerEmail, superOwnerEmailFrom } from "@/lib/auth/owner-rules";
import { EliminarDatosClient } from "./EliminarDatosClient";

/**
 * Eliminación de usuarios de la app (el personal del panel). SOLO el dueño principal: cualquier otro (dueño común incluido) vuelve a
 * Configuración. El endpoint /api/admin/eliminar-datos y la capa de datos lo exigen otra vez; esto evita mostrar la pantalla.
 */
export default async function EliminarDatosPage() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const isSuperOwner =
    !!user && staffAccessOf(user.app_metadata).staffRole === "admin" && isSuperOwnerEmail(user.email, superOwnerEmailFrom(process.env));
  if (!isSuperOwner) redirect("/admin/configuracion");
  return <EliminarDatosClient />;
}
