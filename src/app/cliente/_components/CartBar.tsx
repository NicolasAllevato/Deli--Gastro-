"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { formatMoney } from "@/lib/orders";
import { useCart } from "./CartProvider";

/** Barra flotante con el resumen del carrito (se oculta en el propio carrito y si está vacío). */
export function CartBar() {
  const { count, subtotal } = useCart();
  const pathname = usePathname();

  if (count === 0 || pathname.startsWith("/cliente/carrito")) return null;

  return (
    <Link
      href="/cliente/carrito"
      aria-label={`Ver carrito: ${count} producto${count !== 1 ? "s" : ""}, ${formatMoney(subtotal)}`}
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-[88%] max-w-xs flex items-center justify-between gap-3 px-5 py-3 rounded-full btn-glow text-white font-bold text-sm animate-rise-in"
    >
      <span className="flex items-center gap-2">
        <ShoppingBag size={16} aria-hidden />
        {count} {count === 1 ? "producto" : "productos"}
      </span>
      <span className="font-black">{formatMoney(subtotal)}</span>
    </Link>
  );
}
