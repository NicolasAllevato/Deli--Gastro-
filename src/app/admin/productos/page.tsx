export const dynamic = "force-dynamic";

import { createAdminClient } from "@/utils/supabase/admin";
import type { Category, Product } from "@/types/catalog";
import ProductosClient from "./ProductosClient";

export default async function AdminProductosPage() {
  const db = createAdminClient();
  const [products, categories] = await Promise.all([
    db.from("products").select("*").order("created_at", { ascending: false }),
    db.from("categories").select("*").order("created_at", { ascending: true }),
  ]);

  const initialProducts: Product[] = (products.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: Number(p.price),
    image_url: p.image_url,
    category_id: p.category_id ?? "",
    is_active: p.is_active,
    points_per_100: p.points_per_100 === null ? null : Number(p.points_per_100),
  }));

  const initialCategories: Category[] = (categories.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    is_active: c.is_active,
    points_per_100: c.points_per_100 === null ? null : Number(c.points_per_100),
  }));

  return <ProductosClient initialCategories={initialCategories} initialProducts={initialProducts} />;
}
