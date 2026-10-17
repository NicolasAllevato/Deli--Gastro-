export const dynamic = "force-dynamic";

import { createAdminClient } from "@/utils/supabase/admin";
import { loadCatalog } from "@/lib/catalog/apply";
import CartaClient from "./CartaClient";

export default async function CartaPage() {
  const { products, categories } = await loadCatalog(createAdminClient());
  return <CartaClient initialProducts={products} categories={categories} />;
}
