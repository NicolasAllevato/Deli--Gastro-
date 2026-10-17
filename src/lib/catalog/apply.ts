import { createAdminClient } from "@/utils/supabase/admin";
import type { Category, Product } from "@/types/catalog";
import type { ImportPlan } from "./sheet";

type Db = ReturnType<typeof createAdminClient>;

const INSERT_CHUNK = 100;
const UPDATE_PARALLEL = 20;

function key(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Carta actual (productos + categorías) con la forma que usa el panel. */
export async function loadCatalog(db: Db): Promise<{ products: Product[]; categories: Category[] }> {
  const [products, categories] = await Promise.all([
    db.from("products").select("*").order("created_at", { ascending: true }),
    db.from("categories").select("*").order("created_at", { ascending: true }),
  ]);
  if (products.error) throw new Error(products.error.message);
  if (categories.error) throw new Error(categories.error.message);

  return {
    products: (products.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      image_url: p.image_url,
      category_id: p.category_id ?? "",
      is_active: p.is_active,
      points_per_100: p.points_per_100 === null ? null : Number(p.points_per_100),
    })),
    categories: (categories.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      is_active: c.is_active,
      points_per_100: c.points_per_100 === null ? null : Number(c.points_per_100),
    })),
  };
}

export interface ApplyResult {
  created: number;
  updated: number;
  categoriesCreated: number;
}

/** Aplica un plan ya validado: crea categorías, luego altas y cambios. Nunca borra nada. */
export async function applyImportPlan(db: Db, plan: ImportPlan, categories: readonly Category[]): Promise<ApplyResult> {
  const categoryIds = new Map(categories.map((c) => [key(c.name), c.id]));

  for (const name of plan.newCategories) {
    const { data, error } = await db.from("categories").insert({ name, description: "", is_active: true }).select().single();
    if (error || !data) throw new Error(`No se pudo crear la categoría "${name}".`);
    categoryIds.set(key(name), data.id);
  }
  const idFor = (name: string | null | undefined) => (name ? (categoryIds.get(key(name)) ?? null) : null);

  const inserts = plan.creates.map((p) => ({
    name: p.name,
    description: p.description,
    price: p.price,
    category_id: idFor(p.categoryName),
    is_active: p.isActive,
    points_per_100: p.points,
  }));
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    const { error } = await db.from("products").insert(inserts.slice(i, i + INSERT_CHUNK));
    if (error) throw new Error(`No se pudieron crear productos: ${error.message}`);
  }

  for (let i = 0; i < plan.updates.length; i += UPDATE_PARALLEL) {
    const batch = plan.updates.slice(i, i + UPDATE_PARALLEL);
    const results = await Promise.all(
      batch.map((u) => {
        const { categoryName, ...rest } = u.patch;
        const patch = categoryName === undefined ? rest : { ...rest, category_id: idFor(categoryName) };
        return db.from("products").update(patch).eq("id", u.id);
      }),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`No se pudieron actualizar productos: ${failed.error.message}`);
  }

  return { created: plan.creates.length, updated: plan.updates.length, categoriesCreated: plan.newCategories.length };
}
