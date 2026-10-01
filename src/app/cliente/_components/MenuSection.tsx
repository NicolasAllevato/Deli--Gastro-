"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
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

export function MenuSection({ categories, products, paused }: Props) {
  const [active, setActive] = useState<string>("all");

  const visible = active === "all" ? products : products.filter((p) => p.category_id === active);
  const chips: ReadonlyArray<MenuCategory> = [{ id: "all", name: "Todo" }, ...categories];

  return (
    <section aria-labelledby="menu-title" className="px-5 fade-up-4">
      <h3 id="menu-title" className="font-headline text-xl font-black text-gray-800 mb-4">Menú</h3>

      <div role="tablist" aria-label="Categorías del menú" className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={active === chip.id}
            onClick={() => setActive(chip.id)}
            className={cn(
              "shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all",
              active === chip.id
                ? "bg-brand-orange text-white shadow-[0_3px_8px_rgba(107,124,69,0.3)]"
                : "neumorphic text-gray-600 neumorphic-hover",
            )}
          >
            {chip.name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="neumorphic-inset rounded-2xl p-8 text-center text-sm text-gray-500">
          No hay productos disponibles en esta categoría.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.map((product) => (
            <li key={product.id} className="neumorphic rounded-2xl p-3 flex gap-3 card-hover-lift">
              <div className="w-24 h-24 rounded-xl neumorphic-inset overflow-hidden relative shrink-0 flex items-center justify-center">
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                ) : (
                  <ImageIcon size={26} className="text-gray-300" aria-hidden />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <h4 className="font-headline font-bold text-sm text-gray-800 leading-tight">{product.name}</h4>
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{product.description}</p>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="font-headline font-black text-brand-orange text-sm">{formatMoney(product.price)}</span>
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
