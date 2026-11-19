"use client";

import { useMemo, useState } from "react";
import NextImage from "next/image";
import { Plus, Edit2, Trash2, Settings2, Image as ImageIcon, Tag } from "lucide-react";
import type { Category, Product } from "@/types/catalog";
import { ProductForm } from "./_components/ProductForm";
import { CategoryFormModal } from "./_components/CategoryFormModal";
import { ManageCategoriesModal } from "./_components/ManageCategoriesModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useCanEdit } from "../_components/AdminAccess";

type ProductFilter = "all" | "visible" | "hidden" | "no_photo";
const FILTERS: { id: ProductFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "visible", label: "Visibles" },
  { id: "hidden", label: "Ocultos" },
  { id: "no_photo", label: "Sin foto" },
];

const matchesFilter = (p: Product, f: ProductFilter): boolean =>
  f === "all" ? true
  : f === "visible" ? p.show_in_portal !== false
  : f === "hidden" ? p.show_in_portal === false
  : !p.image_url;

interface Props {
  initialCategories: Category[];
  initialProducts: Product[];
}

/** Respuesta de la API → forma que usa la UI (category_id nunca es null). */
function toProduct(row: Product & { category_id: string | null; price: number | string }): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    image_url: row.image_url,
    category_id: row.category_id ?? "",
    is_active: row.is_active,
    show_in_portal: row.show_in_portal !== false,
    points_per_100: row.points_per_100 === null ? null : Number(row.points_per_100),
    fudo_id: row.fudo_id ?? null,
  };
}

async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la acción.");
  return json;
}

export default function ProductosClient({ initialCategories, initialProducts }: Props) {
  // Con "ver" la lista y los filtros siguen disponibles; las acciones de edición no se muestran (el servidor igual las rechaza).
  const canEdit = useCanEdit("catalogo");
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [products, setProducts]     = useState<Product[]>(initialProducts);
  const [error, setError]           = useState<string | null>(null);
  const [filter, setFilter]         = useState<ProductFilter>("all");
  const [savingPortal, setSavingPortal] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(() => products.filter((p) => matchesFilter(p, filter)), [products, filter]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, products.filter((p) => matchesFilter(p, f.id)).length])) as Record<ProductFilter, number>,
    [products],
  );

  // Ejecuta una acción contra la API y muestra el error si falla.
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    }
  };

  const [isProductFormOpen,  setIsProductFormOpen]  = useState(false);
  const [editingProduct,     setEditingProduct]      = useState<Product | null>(null);
  const [isCategoryFormOpen, setIsCategoryFormOpen]  = useState(false);
  const [editingCategory,    setEditingCategory]     = useState<Category | null>(null);
  const [isManagingCats,     setIsManagingCats]      = useState(false);

  const openProductForm  = (product?: Product)   => { setEditingProduct(product ?? null);   setIsProductFormOpen(true);  };
  const closeProductForm = ()                      => { setEditingProduct(null);               setIsProductFormOpen(false); };

  const openCategoryForm  = (category?: Category) => { setEditingCategory(category ?? null); setIsCategoryFormOpen(true);  };
  const closeCategoryForm = ()                     => { setEditingCategory(null);              setIsCategoryFormOpen(false); };

  const handleProductSubmit = (product: Product) =>
    run(async () => {
      const { id, ...fields } = product;
      const saved = editingProduct
        ? toProduct(await api<Product>("/api/products", "PATCH", { id: editingProduct.id, ...fields }))
        : toProduct(await api<Product>("/api/products", "POST", fields));
      setProducts((prev) =>
        editingProduct ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev.filter((p) => p.id !== id)],
      );
      closeProductForm();
    });

  const handleCategorySubmit = (category: Category) =>
    run(async () => {
      const { id, ...fields } = category;
      const saved = editingCategory
        ? await api<Category>("/api/categories", "PATCH", { id: editingCategory.id, ...fields })
        : await api<Category>("/api/categories", "POST", fields);
      setCategories((prev) =>
        editingCategory ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev.filter((c) => c.id !== id), saved],
      );
      closeCategoryForm();
    });

  const deleteCategory = (id: string) => {
    if (!confirm("¿Estás seguro de eliminar esta categoría?")) return;
    void run(async () => {
      await api("/api/categories?id=" + encodeURIComponent(id), "DELETE");
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setProducts((prev) => prev.map((p) => (p.category_id === id ? { ...p, category_id: "" } : p)));
    });
  };

  const deleteProduct = (id: string) => {
    if (!confirm("¿Eliminar producto?")) return;
    void run(async () => {
      await api("/api/products?id=" + encodeURIComponent(id), "DELETE");
      setProducts((prev) => prev.filter((p) => p.id !== id));
    });
  };

  const toggleProductActive = (id: string) => {
    const current = products.find((p) => p.id === id);
    if (!current) return;
    void run(async () => {
      const saved = toProduct(await api<Product>("/api/products", "PATCH", { id, is_active: !current.is_active }));
      setProducts((prev) => prev.map((p) => (p.id === id ? saved : p)));
    });
  };

  // Guardado optimista: se cambia en pantalla y, si la API falla, se vuelve atrás y se muestra el error.
  const togglePortal = (id: string, next: boolean) => {
    const name = products.find((p) => p.id === id)?.name ?? "el producto";
    setError(null);
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, show_in_portal: next } : p)));
    setSavingPortal((prev) => new Set(prev).add(id));
    void api<Product & { category_id: string | null; price: number | string }>("/api/products", "PATCH", { id, show_in_portal: next })
      .then((row) => {
        const saved = toProduct(row);
        setProducts((prev) => prev.map((p) => (p.id === id ? saved : p)));
      })
      .catch((e: unknown) => {
        setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, show_in_portal: !next } : p)));
        const reason = e instanceof Error ? e.message : "Error desconocido.";
        setError(`No se pudo ${next ? "mostrar" : "ocultar"} "${name}" en el portal: ${reason}`);
      })
      .finally(() => {
        setSavingPortal((prev) => {
          const copy = new Set(prev);
          copy.delete(id);
          return copy;
        });
      });
  };

  return (
    <div className="flex flex-col h-full gap-6 relative overflow-hidden px-2 md:px-6 py-4">

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Catálogo</h2>
          <p className="text-xs font-bold text-gray-500 mt-1 uppercase tracking-widest">Gestiona tu menú</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Settings2 size={16} />}
              onClick={() => setIsManagingCats(true)}
            >
              Categorías
            </Button>
            <Button
              size="sm"
              leftIcon={<Plus size={16} />}
              onClick={() => openProductForm()}
            >
              Nuevo Producto
            </Button>
          </div>
        )}
      </header>

      {error && (
        <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100 shrink-0">
          {error}
        </p>
      )}

      <div role="group" aria-label="Filtrar productos" className="flex gap-2 flex-wrap shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/60 ${
              filter === f.id ? "bg-brand-orange text-white" : "neumorphic text-gray-600 hover:text-gray-800"
            }`}
          >
            {f.label} ({counts[f.id]})
          </button>
        ))}
      </div>

      {/* Products + Sidebar */}
      <div className="flex h-full gap-8 relative overflow-hidden">

        {/* Grid de productos */}
        <div className={`flex-1 flex flex-col gap-6 transition-all duration-300 ${isProductFormOpen ? "hidden lg:flex lg:w-1/2" : "w-full"}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pb-8 pr-2 content-start">
            {shown.length === 0 && (
              <p className="text-sm text-gray-500 col-span-full">No hay productos en este filtro.</p>
            )}
            {shown.map((product) => {
              const category = categories.find((c) => c.id === product.category_id);
              return (
                <div key={product.id} className="neumorphic p-5 rounded-3xl flex flex-col gap-4 relative group hover:-translate-y-1 transition-transform duration-300">
                  <div className="h-40 neumorphic-inset rounded-2xl flex items-center justify-center overflow-hidden relative">
                    {product.image_url ? (
                      <NextImage src={product.image_url} alt={product.name} fill sizes="300px" className="object-cover" />
                    ) : (
                      <ImageIcon size={40} className="text-gray-300" />
                    )}
                    <div className="absolute top-3 left-3 px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full flex items-center gap-1.5 border border-white/50">
                      <Tag size={12} className="text-brand-orange" />
                      <span className="text-[10px] font-black text-gray-800 uppercase tracking-widest">
                        {category?.name ?? "Sin Categoría"}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2 gap-4">
                      <h3 className="font-headline font-bold text-lg text-gray-800 leading-tight">{product.name}</h3>
                      <span className="font-headline font-black text-brand-orange text-lg whitespace-nowrap">${product.price.toLocaleString("es-AR")}</span>
                    </div>
                    <p className="text-gray-500 text-sm font-medium line-clamp-2">{product.description}</p>
                  </div>

                  <Switch
                    checked={product.show_in_portal !== false}
                    onChange={(next) => togglePortal(product.id, next)}
                    disabled={savingPortal.has(product.id) || !canEdit}
                    label="Visible en el portal"
                    aria-label={`Visible en el portal: ${product.name}`}
                    hint={product.show_in_portal === false ? "Oculto: el cliente no lo ve." : product.is_active ? undefined : "Inactivo: no se ve aunque esté prendido."}
                  />

                  <div className="mt-auto flex items-center justify-between pt-4 border-t border-gray-200/50">
                    <button
                      onClick={() => toggleProductActive(product.id)}
                      disabled={product.fudo_id != null || !canEdit}
                      title={product.fudo_id != null ? "La disponibilidad la define Fudo" : undefined}
                      aria-label={product.is_active ? "Desactivar producto" : "Activar producto"}
                      className="transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/60 rounded-full"
                    >
                      <Badge
                        tone={product.is_active ? "green" : "red"}
                        icon={
                          <span className={`w-2 h-2 rounded-full ${product.is_active ? "bg-brand-green" : "bg-red-500"}`} />
                        }
                      >
                        {product.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </button>

                    {canEdit && (
                      <div className="flex gap-2">
                        <Button
                          variant="icon"
                          size="sm"
                          aria-label={`Editar ${product.name}`}
                          onClick={() => openProductForm(product)}
                        >
                          <Edit2 size={14} />
                        </Button>
                        <Button
                          variant="icon"
                          size="sm"
                          aria-label={`Eliminar ${product.name}`}
                          onClick={() => deleteProduct(product.id)}
                          disabled={product.fudo_id != null}
                          className="hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar formulario producto */}
        {isProductFormOpen && (
          <ProductForm
            editingProduct={editingProduct}
            categories={categories}
            onClose={closeProductForm}
            onSubmit={handleProductSubmit}
            onCreateCategory={() => openCategoryForm()}
          />
        )}
      </div>

      {/* Modal: lista de categorías */}
      {isManagingCats && (
        <ManageCategoriesModal
          categories={categories}
          products={products}
          onClose={() => setIsManagingCats(false)}
          onAdd={() => openCategoryForm()}
          onEdit={openCategoryForm}
          onDelete={deleteCategory}
        />
      )}

      {/* Modal: crear / editar categoría */}
      {isCategoryFormOpen && (
        <CategoryFormModal
          editingCategory={editingCategory}
          onClose={closeCategoryForm}
          onSubmit={handleCategorySubmit}
        />
      )}
    </div>
  );
}
