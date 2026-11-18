"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/lib/buttonClasses";
import { formatMoney } from "@/lib/orders";
import type { Category, Product } from "@/types/catalog";
import { PhotosModal } from "./PhotosModal";
import { CartaEstructurada } from "./CartaEstructurada";

interface Preview {
  creates: Array<{ line: number; name: string; price: number; categoryName: string | null }>;
  updates: Array<{ line: number; id: string; name: string; changes: string[]; patch: { price?: number } }>;
  totals: { creates: number; updates: number; unchanged: number; errors: number };
  newCategories: string[];
  errors: Array<{ line: number; message: string }>;
}

interface Props {
  initialProducts: Product[];
  categories: Category[];
}

export default function CartaClient({ initialProducts, categories }: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (selected: File, apply: boolean) => {
    const form = new FormData();
    form.append("file", selected);
    form.append("apply", String(apply));
    const res = await fetch("/api/admin/catalog/import", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "No se pudo procesar el archivo.");
    return json;
  };

  const choose = async (selected: File | undefined) => {
    if (!selected) return;
    setFile(selected);
    setPreview(null);
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setPreview((await send(selected, false)) as unknown as Preview);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el archivo.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = (await send(file, true)) as { created: number; updated: number; categoriesCreated: number; skipped: number };
      setNotice(
        `Listo: ${r.created} producto(s) nuevo(s), ${r.updated} actualizado(s)` +
          (r.categoriesCreated ? `, ${r.categoriesCreated} categoría(s) nueva(s)` : "") +
          (r.skipped ? `. ${r.skipped} fila(s) con error no se aplicaron.` : "."),
      );
      setPreview(null);
      setFile(null);
      const fresh = await fetch("/api/products", { cache: "no-store" });
      if (fresh.ok) {
        const data = (await fresh.json()) as { products: Array<Product & { category_id: string | null; price: number | string }> };
        setProducts(data.products.map((p) => ({ ...p, price: Number(p.price), category_id: p.category_id ?? "" })));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo importar.");
    } finally {
      setBusy(false);
    }
  };

  const nothingToApply = preview !== null && preview.totals.creates + preview.totals.updates === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Carta</h1>
        <p className="text-gray-500 text-xs mt-0.5">
          {products.length} productos · Exportá la carta, editala en Excel (precios, nombres, categorías) y volvé a subirla.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="neumorphic rounded-2xl p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-bold text-sm text-gray-800">
            <Download size={16} aria-hidden /> Exportar
          </h2>
          <p className="text-xs text-gray-500">Descargá la carta completa, incluidos los productos inactivos.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/admin/catalog/export?format=xlsx" className={buttonClasses("primary", "sm")}>Excel (.xlsx)</a>
            <a href="/api/admin/catalog/export?format=csv" className={buttonClasses("secondary", "sm")}>CSV</a>
          </div>
        </section>

        <section className="neumorphic rounded-2xl p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-bold text-sm text-gray-800">
            <Upload size={16} aria-hidden /> Importar
          </h2>
          <p className="text-xs text-gray-500">
            Subí un .xlsx o .csv. Se empareja por ID (o por nombre y categoría). Nunca se borra nada.
          </p>
          <Button size="sm" variant="secondary" loading={busy && !preview} onClick={() => inputRef.current?.click()} leftIcon={<FileSpreadsheet size={14} aria-hidden />}>
            Elegir archivo
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            aria-label="Archivo de la carta"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </section>

        <section className="neumorphic rounded-2xl p-5 space-y-3">
          <h2 className="flex items-center gap-2 font-bold text-sm text-gray-800">
            <ImagePlus size={16} aria-hidden /> Fotos de productos
          </h2>
          <p className="text-xs text-gray-500">Cargá la foto de cada producto o subí todas juntas: si el nombre del archivo coincide con un producto de la carta, se vincula solo.</p>
          <Button size="sm" variant="secondary" onClick={() => setPhotosOpen(true)}>Cargar fotos</Button>
        </section>
      </div>

      {error && <p role="alert" className="text-xs font-bold text-red-600 px-3 py-2 rounded-lg bg-red-50 border border-red-100">{error}</p>}
      {notice && <p role="status" className="text-xs font-bold text-emerald-700 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">{notice}</p>}

      {preview && (
        <section className="neumorphic rounded-2xl p-5 space-y-4" aria-label="Vista previa de la importación">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-sm text-gray-800">Vista previa · {file?.name}</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setPreview(null); setFile(null); }}>Descartar</Button>
              <Button size="sm" onClick={() => void apply()} loading={busy} disabled={nothingToApply}>Aplicar cambios</Button>
            </div>
          </div>
          <ul className="flex flex-wrap gap-2 text-[11px] font-bold">
            <li className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">{preview.totals.creates} nuevos</li>
            <li className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{preview.totals.updates} con cambios</li>
            <li className="px-2.5 py-1 rounded-full neumorphic-inset text-gray-600">{preview.totals.unchanged} sin cambios</li>
            {preview.totals.errors > 0 && <li className="px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-100">{preview.totals.errors} con error (se omiten)</li>}
          </ul>
          {preview.newCategories.length > 0 && (
            <p className="text-xs text-gray-600">Categorías nuevas: {preview.newCategories.join(", ")}</p>
          )}

          {preview.errors.length > 0 && (
            <ul className="text-xs text-red-600 space-y-1">
              {preview.errors.map((e) => <li key={`${e.line}-${e.message}`}>Fila {e.line}: {e.message}</li>)}
            </ul>
          )}

          {(preview.updates.length > 0 || preview.creates.length > 0) && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-gray-500 uppercase tracking-widest text-[10px]">
                  <tr><th scope="col" className="py-2 pr-3">Fila</th><th scope="col" className="py-2 pr-3">Producto</th><th scope="col" className="py-2 pr-3">Cambio</th><th scope="col" className="py-2">Precio</th></tr>
                </thead>
                <tbody className="text-gray-700">
                  {preview.updates.map((u) => {
                    const before = products.find((p) => p.id === u.id)?.price;
                    return (
                      <tr key={u.id} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 text-gray-500">{u.line}</td>
                        <td className="py-1.5 pr-3 font-bold">{u.name}</td>
                        <td className="py-1.5 pr-3">{u.changes.join(", ")}</td>
                        <td className="py-1.5 tabular-nums">
                          {u.patch.price !== undefined && before !== undefined ? `${formatMoney(before)} → ${formatMoney(u.patch.price)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {preview.creates.map((c) => (
                    <tr key={`new-${c.line}`} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 text-gray-500">{c.line}</td>
                      <td className="py-1.5 pr-3 font-bold">{c.name}</td>
                      <td className="py-1.5 pr-3 text-emerald-700">nuevo{c.categoryName ? ` · ${c.categoryName}` : ""}</td>
                      <td className="py-1.5 tabular-nums">{formatMoney(c.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <CartaEstructurada products={[...products].sort((a, b) => a.name.localeCompare(b.name, "es"))} />

      <PhotosModal
        open={photosOpen}
        onClose={() => setPhotosOpen(false)}
        products={products}
        categories={categories}
        onUpdated={(id, url) => setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, image_url: url } : p)))}
      />
    </div>
  );
}
