"use client";

import { useRef, useState } from "react";
import NextImage from "next/image";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Category, Product } from "@/types/catalog";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

type Status = { state: "uploading" } | { state: "error"; message: string };

interface Props {
  open: boolean;
  onClose: () => void;
  products: readonly Product[];
  categories: readonly Category[];
  onUpdated: (id: string, url: string) => void;
}

function key(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Sube la foto a R2 (vía /api/upload) y la asigna al producto. */
async function uploadPhoto(productId: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Usá JPG, PNG o WEBP.");
  if (file.size > MAX_SIZE_BYTES) throw new Error("Supera 5MB.");
  const form = new FormData();
  form.append("file", file);
  const up = await fetch("/api/upload", { method: "POST", body: form });
  const data = (await up.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!up.ok || !data.url) throw new Error(data.error ?? "No se pudo subir.");
  const patch = await fetch("/api/products", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: productId, image_url: data.url }),
  });
  if (!patch.ok) throw new Error("Se subió pero no se pudo asignar.");
  return data.url;
}

export function PhotosModal({ open, onClose, products, categories, onUpdated }: Props) {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [filter, setFilter] = useState<"todos" | "sin-foto">("todos");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const bulkRef = useRef<HTMLInputElement>(null);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const setOne = (id: string, s: Status | null) =>
    setStatus((prev) => {
      const rest = Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id));
      return s ? { ...rest, [id]: s } : rest;
    });

  const upload = async (product: Product, file: File) => {
    setOne(product.id, { state: "uploading" });
    try {
      onUpdated(product.id, await uploadPhoto(product.id, file));
      setOne(product.id, null);
    } catch (e: unknown) {
      setOne(product.id, { state: "error", message: e instanceof Error ? e.message : "Error." });
    }
  };

  // Varias fotos a la vez: cada archivo se asigna al producto con el mismo nombre ("Muzzarella.jpg").
  const bulk = async (files: FileList | null) => {
    if (!files) return;
    const byName = new Map(products.map((p) => [key(p.name), p]));
    const unmatched: string[] = [];
    const jobs: Promise<void>[] = [];
    for (const file of Array.from(files)) {
      const product = byName.get(key(file.name.replace(/\.[^.]+$/, "")));
      if (product) jobs.push(upload(product, file));
      else unmatched.push(file.name);
    }
    setBulkNote(
      `${jobs.length} foto(s) asignada(s) por nombre.` + (unmatched.length ? ` Sin producto: ${unmatched.join(", ")}.` : ""),
    );
    await Promise.all(jobs);
    if (bulkRef.current) bulkRef.current.value = "";
  };

  const list = filter === "sin-foto" ? products.filter((p) => !p.image_url) : products;

  return (
    <Modal open={open} onClose={onClose} title="Fotos de productos" description="Se muestran en el menú del cliente. Subí una por producto o varias juntas con el nombre del producto como nombre de archivo (ej. Muzzarella.jpg)." size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2" role="group" aria-label="Filtrar">
            {(["todos", "sin-foto"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${filter === f ? "bg-brand-orange text-white" : "neumorphic text-gray-600"}`}
              >
                {f === "todos" ? "Todos" : "Sin foto"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" leftIcon={<Upload size={14} aria-hidden />} onClick={() => bulkRef.current?.click()}>
            Subir todas juntas
          </Button>
          <input
            ref={bulkRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="Fotos para asignar por nombre de archivo"
            onChange={(e) => void bulk(e.target.files)}
          />
        </div>
        {bulkNote && <p role="status" className="text-xs text-gray-600">{bulkNote}</p>}

        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {list.map((p) => {
            const s = status[p.id];
            return (
              <li key={p.id} className="neumorphic rounded-2xl p-2 space-y-2">
                <label className="block relative h-24 rounded-xl overflow-hidden neumorphic-inset cursor-pointer group">
                  {p.image_url ? (
                    <NextImage src={p.image_url} alt={p.name} fill sizes="200px" className="object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-gray-300"><ImageIcon size={26} aria-hidden /></span>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                    {s?.state === "uploading"
                      ? <Loader2 size={20} className="text-white animate-spin" aria-hidden />
                      : <Upload size={18} className="text-white opacity-0 group-hover:opacity-100" aria-hidden />}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label={`${p.image_url ? "Cambiar" : "Subir"} foto de ${p.name}`}
                    disabled={s?.state === "uploading"}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(p, f); e.target.value = ""; }}
                  />
                </label>
                <div className="px-1">
                  <p className="text-xs font-bold text-gray-800 truncate">{p.name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{categoryName.get(p.category_id) ?? "Sin categoría"}</p>
                  {s?.state === "error" && <p role="alert" className="text-[10px] font-bold text-red-600">{s.message}</p>}
                </div>
              </li>
            );
          })}
          {list.length === 0 && <li className="col-span-full text-center text-xs text-gray-500 py-6">Todos los productos tienen foto.</li>}
        </ul>
      </div>
    </Modal>
  );
}
