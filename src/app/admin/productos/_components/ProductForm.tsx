"use client";

import { useRef, useState } from "react";
import NextImage from "next/image";
import { Image as ImageIcon, Tag, Loader2, Upload } from "lucide-react";
import type { Product, Category } from "@/types/catalog";
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

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function ProductForm({ editingProduct, categories, onClose, onSubmit, onCreateCategory }: Props) {
  const [isActive, setIsActive] = useState(editingProduct ? editingProduct.is_active : true);
  const [imageUrl, setImageUrl] = useState<string | null>(editingProduct?.image_url ?? null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError("Formato no permitido. Usá JPG, PNG o WEBP.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setUploadError("El archivo supera el límite de 5MB.");
      e.target.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json()) as { success?: boolean; url?: string; error?: string };
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.error ?? "No se pudo subir la imagen.");
      }
      setImageUrl(data.url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error subiendo la imagen.";
      setUploadError(message);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onSubmit({
      id:          editingProduct?.id ?? crypto.randomUUID(),
      name:        fd.get("name") as string,
      description: fd.get("description") as string,
      price:       parseFloat(fd.get("price") as string),
      image_url:   imageUrl ?? "",
      category_id: fd.get("category_id") as string,
      is_active:   isActive,
    });
  };

  return (
    <div className="w-full lg:w-[450px] xl:w-[500px] h-full flex-shrink-0 animate-slide-in-right">
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
          {/* Imagen del producto: preview + upload a R2 */}
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full h-32 neumorphic-inset rounded-2xl overflow-hidden relative flex items-center justify-center group disabled:opacity-70"
              aria-label={imageUrl ? "Cambiar imagen del producto" : "Subir imagen del producto"}
            >
              {imageUrl ? (
                <NextImage src={imageUrl} alt={editingProduct?.name ?? "Producto"} fill sizes="450px" className="object-cover" />
              ) : (
                <ImageIcon size={32} className="text-gray-300" />
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                {isUploading ? (
                  <Loader2 size={22} className="text-white animate-spin" />
                ) : (
                  <Upload size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
            {uploadError && (
              <p className="mt-2 ml-2 text-xs font-semibold text-red-500">{uploadError}</p>
            )}
          </div>

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
              <label htmlFor="product-category" className="text-xs font-bold text-gray-600 uppercase tracking-widest">Categoría</label>
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
                id="product-category"
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

          <div className="mt-auto pt-4 flex gap-4">
            <Button variant="secondary" type="button" onClick={onClose} fullWidth>
              Cancelar
            </Button>
            <Button type="submit" fullWidth disabled={isUploading} loading={isUploading}>
              Guardar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
