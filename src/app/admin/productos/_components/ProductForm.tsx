"use client";

import { parsePoints } from "@/lib/catalog/points";
import { useRef, useState } from "react";
import NextImage from "next/image";
import { Image as ImageIcon, Tag, Loader2, Upload, Trash2 } from "lucide-react";
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
  // Si el producto viene de Fudo, nombre, categoría, precio y disponibilidad son de solo lectura (los manda Fudo).
  const fromFudo = editingProduct?.fudo_id != null;
  const [isActive, setIsActive] = useState(editingProduct ? editingProduct.is_active : true);
  // Alta manual: visible por defecto. Producto existente: conserva lo que eligió el admin.
  const [showInPortal, setShowInPortal] = useState(editingProduct ? editingProduct.show_in_portal !== false : true);
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
    // Los campos deshabilitados no viajan en el FormData: para los de Fudo se reusan los valores actuales.
    onSubmit({
      id:          editingProduct?.id ?? crypto.randomUUID(),
      name:        fromFudo ? editingProduct.name : (fd.get("name") as string),
      description: fd.get("description") as string,
      price:       fromFudo ? editingProduct.price : parseFloat(fd.get("price") as string),
      image_url:   imageUrl ?? "",
      category_id: fromFudo ? editingProduct.category_id : (fd.get("category_id") as string),
      is_active:   fromFudo ? editingProduct.is_active : isActive,
      show_in_portal: showInPortal,
      points_per_100: parsePoints(fd.get("points_per_100")),
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
          {fromFudo && (
            <p role="note" className="badge-blue text-xs font-bold px-3 py-2 rounded-lg">
              Este producto viene de Fudo: nombre, categoría, precio y disponibilidad se cambian allá y se actualizan solos. Acá podés editar la foto, la descripción, los puntos y si se ve en el portal.
            </p>
          )}
          {/* Imagen del producto: preview + upload a R2 */}
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full aspect-[4/3] neumorphic-inset rounded-2xl overflow-hidden relative flex items-center justify-center group disabled:opacity-70"
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
            <div className="mt-2 ml-2 flex items-center justify-between gap-3">
              <p className="text-[11px] text-gray-500">JPG, PNG o WEBP, hasta 5MB. Se ve recortada al centro.</p>
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  disabled={isUploading}
                  className="flex items-center gap-1 text-[11px] font-bold text-red-500 hover:underline disabled:opacity-50"
                >
                  <Trash2 size={12} aria-hidden />
                  Quitar foto
                </button>
              )}
            </div>
            {uploadError && (
              <p role="alert" className="mt-2 ml-2 text-xs font-semibold text-red-500">{uploadError}</p>
            )}
          </div>

          <Field
            label="Nombre del Producto"
            name="name"
            type="text"
            required
            disabled={fromFudo}
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
                disabled={fromFudo}
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
              disabled={fromFudo}
              placeholder="0"
              defaultValue={editingProduct?.price}
            />
            <div className="neumorphic-inset rounded-xl px-4 py-3.5 mb-0.5">
              <Switch
                checked={isActive}
                onChange={setIsActive}
                disabled={fromFudo}
                label="Disponible"
              />
            </div>
          </div>

          <div className="neumorphic-inset rounded-xl px-4 py-3.5">
            <Switch
              checked={showInPortal}
              onChange={setShowInPortal}
              label="Visible en el portal"
              hint="Si está apagado, el cliente no lo ve en la carta ni lo puede pedir."
            />
          </div>

          <Field
            label="Puntos por cada $100 (opcional)"
            name="points_per_100"
            type="number"
            step="0.1"
            min="0"
            placeholder="Vacío = usa los de la categoría"
            defaultValue={editingProduct?.points_per_100 ?? undefined}
          />

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
