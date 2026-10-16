"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ImageIcon, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/orders";
import { AddToCartButton } from "./AddToCartButton";

export interface MenuCategory {
  id: string;
  name: string;
}

export interface MenuProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  category_id: string | null;
}

interface Props {
  categories: readonly MenuCategory[];
  products: readonly MenuProduct[];
  /** Con el local en pausa se puede ver el menú pero no agregar. */
  paused: boolean;
}

/** Normaliza para buscar sin importar mayúsculas ni tildes ("limon" encuentra "Limón"). */
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MenuSection({ categories, products, paused }: Props) {
  const [active, setActive] = useState<string>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) if (p.category_id) map.set(p.category_id, (map.get(p.category_id) ?? 0) + 1);
    return map;
  }, [products]);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return products.filter(
      (p) =>
        (active === "all" || p.category_id === active) &&
        (!q || normalize(`${p.name} ${p.description}`).includes(q)),
    );
  }, [products, active, query]);

  const chips: ReadonlyArray<MenuCategory & { count: number }> = [
    { id: "all", name: "Todo", count: products.length },
    ...categories.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })),
  ];

  return (
    <section aria-labelledby="menu-title" className="px-5 fade-up-4">
      <div className="flex items-end justify-between gap-3 mb-4">
        <h3 id="menu-title" className="font-headline text-xl font-black text-gray-800">Menú</h3>
        <span className="text-xs font-bold text-gray-500">{visible.length} {visible.length === 1 ? "producto" : "productos"}</span>
      </div>

      {/* Buscador + categorías: quedan visibles al bajar por el menú */}
      <div className="sticky top-[61px] z-30 -mx-5 px-5 pt-2 pb-3 glass-effect">
        <label className="neumorphic-inset rounded-full flex items-center gap-2 px-4 py-2.5">
          <Search size={16} className="text-gray-500 shrink-0" aria-hidden />
          <span className="sr-only">Buscar en el menú</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="¿Qué tenés ganas de comer?"
            className="bg-transparent outline-none text-sm text-gray-800 placeholder-gray-500 flex-1 min-w-0"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Borrar búsqueda" className="text-gray-500 hover:text-gray-800">
              <X size={16} aria-hidden />
            </button>
          )}
        </label>

        <div role="tablist" aria-label="Categorías del menú" className="flex gap-2 overflow-x-auto mt-3 -mx-1 px-1 pb-1">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={active === chip.id}
              onClick={() => setActive(chip.id)}
              className={cn(
                "shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all inline-flex items-center gap-1.5",
                active === chip.id
                  ? "bg-brand-orange text-white shadow-[0_3px_8px_rgba(124,58,237,0.3)]"
                  : "neumorphic text-gray-600 neumorphic-hover",
              )}
            >
              {chip.name}
              <span className={cn("text-[10px] font-black", active === chip.id ? "text-white/80" : "text-gray-400")}>{chip.count}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="neumorphic-inset rounded-2xl p-8 mt-3 text-center text-sm text-gray-500">
          {query ? (
            <>
              No encontramos &ldquo;{query}&rdquo;.{" "}
              <button type="button" className="font-bold underline text-gray-800" onClick={() => { setQuery(""); setActive("all"); }}>
                Ver todo el menú
              </button>
            </>
          ) : (
            "No hay productos disponibles en esta categoría."
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 stagger">
          {visible.map((product) => (
            <li key={product.id} className="neumorphic rounded-2xl p-3 flex gap-3 card-hover-lift">
              <div className="w-28 h-28 rounded-xl neumorphic-inset overflow-hidden relative shrink-0 flex items-center justify-center">
                {product.image_url ? (
                  <Image src={product.image_url} alt={product.name} fill sizes="112px" className="object-cover" />
                ) : (
                  <ImageIcon size={26} className="text-gray-300" aria-hidden />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <h4 className="font-headline font-bold text-sm text-gray-800 leading-tight">{product.name}</h4>
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-3">{product.description}</p>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="font-headline font-black text-brand-orange text-base">{formatMoney(product.price)}</span>
                  <AddToCartButton
                    product={{ id: product.id, name: product.name, price: product.price, image_url: product.image_url }}
                    disabled={paused}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
