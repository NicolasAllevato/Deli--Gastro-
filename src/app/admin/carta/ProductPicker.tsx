"use client";

import { useId, useMemo, useState } from "react";
import { formatMoney } from "@/lib/orders";

export interface PickerProduct {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
}

interface Props {
  label: string;
  value: string | null;
  products: readonly PickerProduct[];
  onChange: (id: string | null) => void;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Selector de producto con búsqueda: escribir filtra la lista; muestra el precio actual (de Fudo). */
export function ProductPicker({ label, value, products, onChange }: Props) {
  const [query, setQuery] = useState("");
  const id = useId();
  const current = products.find((p) => p.id === value) ?? null;
  const options = useMemo(() => {
    const q = fold(query.trim());
    const list = q ? products.filter((p) => fold(p.name).includes(q)) : products;
    return list.slice(0, 80);
  }, [products, query]);

  return (
    <div className="space-y-1 min-w-0">
      <label htmlFor={`${id}-q`} className="block text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</label>
      <input
        id={`${id}-q`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={current ? `${current.name} · ${formatMoney(current.price)}` : "Buscar producto…"}
        className="w-full rounded-lg neumorphic-inset px-2 py-1.5 text-xs text-gray-800"
      />
      <select
        aria-label={`${label}: elegir producto`}
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value || null);
          setQuery("");
        }}
        className="w-full rounded-lg neumorphic-inset px-2 py-1.5 text-xs text-gray-800"
      >
        <option value="">— Sin vincular —</option>
        {current && !options.some((o) => o.id === current.id) && (
          <option value={current.id}>{current.name} · {formatMoney(current.price)}</option>
        )}
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {formatMoney(p.price)}{p.is_active ? "" : " (inactivo)"}
          </option>
        ))}
      </select>
      {current && !current.is_active && <p className="text-[11px] font-bold text-amber-700">Producto inactivo: no se muestra el precio.</p>}
    </div>
  );
}
