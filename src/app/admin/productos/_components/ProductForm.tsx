"use client";

import { useState } from "react";
import NextImage from "next/image";
import { Image as ImageIcon, Tag } from "lucide-react";
import type { Product, Category } from "@/fixtures/productos";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";

interface Props {
  editingProduct: Product | null;
  categories: Category[];
  onClose: () => void;
  onSubmit: (product: Product) => void;
  onCreateCategory: () => void;
}

export function ProductForm({ editingProduct, categories, onClose, onSubmit, onCreateCategory }: Props) {
  const [isActive, setIsActive] = useState(editingProduct ? editingProduct.is_active : true);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      id:          editingProduct?.id ?? crypto.randomUUID(),
      name:        fd.get("name") as string,
      description: fd.get("description") as string,
      price:       parseFloat(fd.get("price") as string),
      image_url:   fd.get("image_url") as string,
      category_id: fd.get("category_id") as string,
      is_active:   isActive,
    });
  };

  return (
    <div className="w-full lg:w-[450px] xl:w-[500px] h-full flex-shrink-0 animate-in slide-in-from-right-8 duration-300">
      <div className="neumorphic h-full rounded-3xl p-6 md:p-8 flex flex-col">
        <header className="flex items-center justify-between mb-8 shrink-0">
          <h2 className="text-2xl font-headline font-black text-gray-800">
            {editingProduct ? "Editar Producto" : "Nuevo Producto"}
          </h2>
          <Button
            variant="icon"
            aria-label="Cerrar panel"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-5 overflow-y-auto pr-2 pb-4">
          {/* Preview imagen */}
          {editingProduct?.image_url ? (
            <div className="h-32 neumorphic-inset rounded-2xl overflow-hidden relative">
              <NextImage src={editingProduct.image_url} alt={editingProduct.name} fill sizes="450px" className="object-cover" />
            </div>
          ) : (
            <div className="h-28 neumorphic-inset rounded-2xl flex items-center justify-center">
              <ImageIcon size={32} className="text-gray-300" />
            </div>
          )}

          <Field
            label="Nombre del Producto"
            name="name"
            type="text"
            required
            placeholder="Ej. Hamburguesa Clásica"
            defaultValue={editingProduct?.name}
          />

          {/* Categoría con select custom */}
          <div>
            <div className="flex items-center justify-between mb-2 ml-4 mr-2">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-widest">Categoría</label>
              <button
                type="button"
                onClick={onCreateCategory}
                className="text-[10px] font-black text-brand-orange uppercase tracking-wider hover:underline"
              >
                + Crear Categoría
              </button>
            </div>
            <div className="relative">
              <select
                name="category_id"
                defaultValue={editingProduct?.category_id ?? ""}
                required
                className="w-full px-6 py-4 rounded-2xl neumorphic-inset text-gray-800 outline-none focus:ring-2 focus:ring-brand-orange/50 transition-all font-bold appearance-none bg-transparent"
              >
                <option value="" disabled>Seleccionar Categoría</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <Tag size={14} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-gray-500" />
            </div>
          </div>

          <Field
            as="textarea"
            label="Descripción"
            name="description"
            required
            rows={3}
            placeholder="Detalles de los ingredientes..."
            defaultValue={editingProduct?.description}
          />

          <div className="grid grid-cols-2 gap-4 items-end">
            <Field
              label="Precio ($)"
              name="price"
              type="number"
              step="1"
              required
              placeholder="0"
              defaultValue={editingProduct?.price}
            />
            <div className="neumorphic-inset rounded-xl px-4 py-3.5 mb-0.5">
              <Switch
                checked={isActive}
                onChange={setIsActive}
                label="Visible al cliente"
              />
            </div>
          </div>

          <Field
            label="URL de Imagen"
            name="image_url"
            type="url"
            placeholder="https://..."
            defaultValue={editingProduct?.image_url}
          />

          <div className="mt-auto pt-4 flex gap-4">
            <Button variant="secondary" type="button" onClick={onClose} fullWidth>
              Cancelar
            </Button>
            <Button type="submit" fullWidth>
              Guardar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
