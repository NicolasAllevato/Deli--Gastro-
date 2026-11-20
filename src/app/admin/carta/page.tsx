export const dynamic = "force-dynamic";

import { createAdminClient } from "@/utils/supabase/admin";
import { loadCatalog } from "@/lib/catalog/apply";
import CartaClient from "./CartaClient";
import { EditableArea } from "../_components/AdminAccess";

export default async function CartaPage() {
  const { products, categories } = await loadCatalog(createAdminClient());
  return (
    <EditableArea section="configuracion">
      <CartaClient initialProducts={products} categories={categories} />
    </EditableArea>
  );
}
