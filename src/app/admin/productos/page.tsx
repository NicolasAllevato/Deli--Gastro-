"use client";

import { useState } from "react";
import NextImage from "next/image";
import { Plus, Edit2, Trash2, Settings2, Image as ImageIcon, Tag } from "lucide-react";
import { mockCategories, mockProducts, type Category, type Product } from "@/fixtures/productos";
import { ProductForm } from "./_components/ProductForm";
import { CategoryFormModal } from "./_components/CategoryFormModal";
import { ManageCategoriesModal } from "./_components/ManageCategoriesModal";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export default function AdminProductosPage() {
  const [categories, setCategories] = useState<Category[]>(mockCategories);
  const [products, setProducts]     = useState<Product[]>(mockProducts);

  const [isProductFormOpen,  setIsProductFormOpen]  = useState(false);
  const [editingProduct,     setEditingProduct]      = useState<Product | null>(null);
  const [isCategoryFormOpen, setIsCategoryFormOpen]  = useState(false);
  const [editingCategory,    setEditingCategory]     = useState<Category | null>(null);
  const [isManagingCats,     setIsManagingCats]      = useState(false);

  const openProductForm  = (product?: Product)   => { setEditingProduct(product ?? null);   setIsProductFormOpen(true);  };
  const closeProductForm = ()                      => { setEditingProduct(null);               setIsProductFormOpen(false); };

  const openCategoryForm  = (category?: Category) => { setEditingCategory(category ?? null); setIsCategoryFormOpen(true);  };
  const closeCategoryForm = ()                     => { setEditingCategory(null);              setIsCategoryFormOpen(false); };

  const handleProductSubmit = (product: Product) => {
    setProducts((prev) =>
      editingProduct ? prev.map((p) => (p.id === product.id ? product : p)) : [product, ...prev]
    );
    closeProductForm();
  };

  const handleCategorySubmit = (category: Category) => {
    setCategories((prev) =>
      editingCategory ? prev.map((c) => (c.id === category.id ? category : c)) : [...prev, category]
    );
    closeCategoryForm();
  };

  const deleteCategory = (id: string) => {
    if (!confirm("¿Estás seguro de eliminar esta categoría?")) return;
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setProducts((prev) => prev.map((p) => (p.category_id === id ? { ...p, category_id: "" } : p)));
  };

  const toggleProductActive = (id: string) =>
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: !p.is_active } : p)));

  return (
    <div className="flex flex-col h-full gap-6 relative overflow-hidden px-2 md:px-6 py-4">

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="font-headline text-3xl font-black text-gray-800 tracking-tight">Catálogo</h2>
          <p className="text-xs font-bold text-gray-500 mt-1 uppercase tracking-widest">Gestiona tu menú</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            leftIcon={<Settings2 size={18} />}
            onClick={() => setIsManagingCats(true)}
          >
            Categorías
          </Button>
          <Button
            leftIcon={<Plus size={18} />}
            onClick={() => openProductForm()}
          >
            Nuevo Producto
          </Button>
        </div>
      </header>

      {/* Products + Sidebar */}
      <div className="flex h-full gap-8 relative overflow-hidden">

        {/* Grid de productos */}
        <div className={`flex-1 flex flex-col gap-6 transition-all duration-300 ${isProductFormOpen ? "hidden lg:flex lg:w-1/2" : "w-full"}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pb-8 pr-2 content-start">
            {products.map((product) => {
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

                  <div className="mt-auto flex items-center justify-between pt-4 border-t border-gray-200/50">
                    <button
                      onClick={() => toggleProductActive(product.id)}
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
                        onClick={() => { if (confirm("¿Eliminar producto?")) setProducts((prev) => prev.filter((p) => p.id !== product.id)); }}
                        className="hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
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
