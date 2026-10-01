"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import { formatMoney } from "@/lib/orders";
import { useCart, type CartProduct } from "./CartProvider";

interface Props {
  product: CartProduct;
  /** "hero" agrega y va directo al carrito; "card" muestra selector de cantidad. */
  variant?: "card" | "hero";
  disabled?: boolean;
}

export function AddToCartButton({ product, variant = "card", disabled = false }: Props) {
  const router = useRouter();
  const { lines, add, setQty } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const qty = lines.find((l) => l.id === product.id)?.qty ?? 0;

  if (variant === "hero") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          add(product);
          router.push("/cliente/carrito");
        }}
        className="btn-glow text-white font-bold px-6 py-3 rounded-full flex items-center gap-2 text-sm disabled:opacity-50"
      >
        Pedir — {formatMoney(product.price)} <ArrowRight size={15} aria-hidden />
      </button>
    );
  }

  if (qty > 0) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label={`Cantidad de ${product.name}`}>
        <button
          type="button"
          onClick={() => setQty(product.id, qty - 1)}
          aria-label={`Quitar una unidad de ${product.name}`}
          className="w-8 h-8 rounded-full neumorphic neumorphic-hover flex items-center justify-center text-gray-600"
        >
          <Minus size={14} aria-hidden />
        </button>
        <span className="w-5 text-center text-sm font-black text-gray-800" aria-live="polite">{qty}</span>
        <button
          type="button"
          onClick={() => setQty(product.id, qty + 1)}
          aria-label={`Agregar otra unidad de ${product.name}`}
          className="w-8 h-8 rounded-full bg-brand-orange text-white flex items-center justify-center shadow-[0_3px_8px_rgba(107,124,69,0.3)]"
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        add(product);
        setJustAdded(true);
        window.setTimeout(() => setJustAdded(false), 900);
      }}
      aria-label={`Agregar ${product.name} al carrito`}
      className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-orange text-white text-xs font-black shadow-[0_3px_8px_rgba(107,124,69,0.3)] hover:scale-105 active:scale-95 transition-transform disabled:opacity-50"
    >
      {justAdded ? <Check size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
      {justAdded ? "Agregado" : "Agregar"}
    </button>
  );
}
