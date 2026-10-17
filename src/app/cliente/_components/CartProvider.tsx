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
  /** Recompensa de puntos elegida para este pedido (se aplica y cobra al confirmarlo). */
  rewardId: string | null;
  setReward: (rewardId: string | null) => void;
  clear: () => void;
}

const STORAGE_KEY = "deli-gastro-cart";
const REWARD_KEY = "deli-gastro-cart-reward";
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

function readStoredReward(): string | null {
  try {
    return window.sessionStorage.getItem(REWARD_KEY);
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // El carrito sólo vive en esta pestaña (sessionStorage): al cerrar, se pierde.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(readStored());
    setRewardId(readStoredReward());
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

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (rewardId) window.sessionStorage.setItem(REWARD_KEY, rewardId);
      else window.sessionStorage.removeItem(REWARD_KEY);
    } catch {
      /* sin storage: la recompensa sigue en memoria */
    }
  }, [rewardId, hydrated]);

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

  const setReward = useCallback((id: string | null) => setRewardId(id), []);

  const clear = useCallback(() => {
    setLines([]);
    setRewardId(null);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      count: lines.reduce((sum, l) => sum + l.qty, 0),
      subtotal: lines.reduce((sum, l) => sum + l.price * l.qty, 0),
      add,
      setQty,
      rewardId,
      setReward,
      clear,
    }),
    [lines, add, setQty, rewardId, setReward, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return ctx;
}
