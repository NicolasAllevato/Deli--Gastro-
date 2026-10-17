"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Check, Coins } from "lucide-react";
import { formatMoney, pointsForLines } from "@/lib/orders";
import { parsePoints } from "@/lib/catalog/points";
import { cn } from "@/lib/cn";

export interface CategoriaPuntos {
  id: string;
  nombre: string;
  puntosPor100: number | null;
}

export interface ProductoPuntos {
  id: string;
  nombre: string;
  precio: number;
  categoriaId: string | null;
  puntosPor100: number | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** Puntos que suma una unidad del plato con las tasas dadas. */
function pointsFor(price: number, productRate: number | null, categoryRate: number | null): number {
  return pointsForLines([{ price, qty: 1, productRate, categoryRate }]);
}

async function savePoints(kind: "categories" | "products", id: string, value: number | null): Promise<boolean> {
  const res = await fetch(`/api/${kind}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, points_per_100: value }),
  }).catch(() => null);
  return !!res?.ok;
}

function PointsInput({
  value,
  placeholder,
  label,
  onSave,
}: {
  value: number | null;
  placeholder: string;
  label: string;
  onSave: (value: number | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [state, setState] = useState<SaveState>("idle");

  const commit = async () => {
    const next = parsePoints(draft);
    if (draft.trim() !== "" && next === null) {
      setState("error");
      return;
    }
    if (next === value) return;
    setState("saving");
    setState((await onSave(next)) ? "saved" : "error");
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setState("idle"); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        className={cn(
          "w-20 rounded-lg neumorphic-inset px-2 py-1.5 text-right text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-brand-orange",
          state === "error" && "ring-2 ring-red-500",
        )}
      />
      <span className="w-4" aria-live="polite">
        {state === "saved" && <Check size={14} className="text-green-500" aria-label="Guardado" />}
        {state === "saving" && <span className="text-[10px] text-gray-400">…</span>}
      </span>
    </div>
  );
}

export default function PuntosCatalogo({
  categorias,
  productos,
}: {
  categorias: CategoriaPuntos[];
  productos: ProductoPuntos[];
}) {
  const [rates, setRates] = useState<Record<string, number | null>>(() =>
    Object.fromEntries([...categorias, ...productos].map((x) => [x.id, x.puntosPor100])),
  );
  const [open, setOpen] = useState<string | null>(categorias[0]?.id ?? null);

  const save = (kind: "categories" | "products", id: string) => async (value: number | null) => {
    const ok = await savePoints(kind, id, value);
    if (ok) setRates((prev) => ({ ...prev, [id]: value }));
    return ok;
  };

  const groups = [
    ...categorias.map((c) => ({ categoria: c, items: productos.filter((p) => p.categoriaId === c.id) })),
    { categoria: null, items: productos.filter((p) => !p.categoriaId) },
  ].filter((g) => g.categoria || g.items.length > 0);

  return (
    <section className="neumorphic rounded-2xl p-4 md:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full neumorphic-inset flex items-center justify-center text-brand-orange shrink-0">
          <Coins size={18} aria-hidden />
        </div>
        <div>
          <h2 className="font-headline font-black text-lg text-gray-800">Puntos que suma cada categoría y plato</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            Puntos por cada $100 gastados. El plato con valor propio usa ese; si lo dejás vacío, usa el de su categoría.
            Se guarda al salir del campo.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {groups.map(({ categoria, items }) => {
          const key = categoria?.id ?? "sin-categoria";
          const expanded = open === key;
          const catRate = categoria ? rates[categoria.id] ?? null : null;
          return (
            <div key={key} className="rounded-xl neumorphic-inset p-2 md:p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : key)}
                  aria-expanded={expanded}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  {expanded ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                  <span className="font-bold text-gray-800 truncate">{categoria?.nombre ?? "Sin categoría"}</span>
                  <span className="text-[11px] text-gray-500 shrink-0">{items.length} platos</span>
                </button>
                {categoria && (
                  <PointsInput
                    value={catRate}
                    placeholder="0"
                    label={`Puntos por $100 de ${categoria.nombre}`}
                    onSave={save("categories", categoria.id)}
                  />
                )}
              </div>

              {expanded && items.length > 0 && (
                <ul className="mt-2 divide-y divide-[var(--app-border)]">
                  {items.map((p) => {
                    const own = rates[p.id] ?? null;
                    return (
                      <li key={p.id} className="flex items-center gap-2 py-2 pl-6">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{p.nombre}</p>
                          <p className="text-[11px] text-gray-500">
                            {formatMoney(p.precio)} · suma <strong>{pointsFor(p.precio, own, catRate)}</strong> pts
                            {own === null && catRate !== null && " (de la categoría)"}
                          </p>
                        </div>
                        <PointsInput
                          value={own}
                          placeholder={catRate === null ? "—" : String(catRate)}
                          label={`Puntos por $100 de ${p.nombre}`}
                          onSave={save("products", p.id)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
