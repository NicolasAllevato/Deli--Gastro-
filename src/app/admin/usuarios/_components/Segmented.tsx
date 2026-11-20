"use client";

import { cn } from "@/lib/cn";

interface SegmentedProps<T extends string> {
  /** Nombre del grupo de radios (único por grupo en la pantalla). */
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Oculta la leyenda a la vista pero la deja para el lector de pantalla (en filas de tabla). */
  hideLegend?: boolean;
}

/** Selector de una opción entre pocas (radios con aspecto de botones). Teclado: flechas, como cualquier radio. */
export function Segmented<T extends string>({ name, legend, options, value, onChange, disabled = false, hideLegend = false }: SegmentedProps<T>) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className={cn("text-xs font-bold text-gray-600 uppercase tracking-widest mb-2", hideLegend && "sr-only")}>{legend}</legend>
      <div className="inline-flex gap-1 p-1 rounded-full neumorphic-inset">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors focus-within:ring-2 focus-within:ring-brand-orange/60",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              value === o.value ? "neumorphic text-brand-orange" : "text-gray-500 hover:text-gray-800",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
