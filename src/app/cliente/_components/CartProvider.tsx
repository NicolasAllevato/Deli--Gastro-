"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CartProduct {
  id: string;
  name: string;
  price: number;
  image_url: string;
}

export interface CartLine extends CartProduct {
  qty: number;
}

interface CartContextValue {
  lines: readonly CartLine[];
  count: number;
  subtotal: number;
  add: (product: CartProduct) => void;
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
}

const STORAGE_KEY = "deli-gastro-cart";
const MAX_QTY = 20;

const CartContext = createContext<CartContextValue | null>(null);

function readStored(): CartLine[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // El carrito sólo vive en esta pestaña (sessionStorage): al cerrar, se pierde.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(readStored());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* sin storage: el carrito sigue funcionando en memoria */
    }
  }, [lines, hydrated]);

  const add = useCallback((product: CartProduct) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.id === product.id);
      if (!existing) return [...prev, { ...product, qty: 1 }];
      return prev.map((l) => (l.id === product.id ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l));
    });
  }, []);

  const setQty = useCallback((productId: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.id !== productId)
        : prev.map((l) => (l.id === productId ? { ...l, qty: Math.min(MAX_QTY, qty) } : l)),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      count: lines.reduce((sum, l) => sum + l.qty, 0),
      subtotal: lines.reduce((sum, l) => sum + l.price * l.qty, 0),
      add,
      setQty,
      clear,
    }),
    [lines, add, setQty, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return ctx;
}
