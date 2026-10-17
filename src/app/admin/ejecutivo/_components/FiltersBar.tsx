"use client";

import { RANGE_LABELS, type RangeKey } from "@/lib/reports/range";

interface Props {
  range: RangeKey | null;
  zone: string | null;
  zoneOptions: Array<{ id: string; label: string }>;
  onRange: (range: RangeKey) => void;
  onZone: (zone: string | null) => void;
}

const BASE_RANGES: RangeKey[] = ["today", "last_7_days", "this_month"];
const BASE_LABELS: Partial<Record<RangeKey, string>> = {
  today: "Hoy",
  last_7_days: "Última semana",
  this_month: "Mes actual",
};

export function FiltersBar({ range, zone, zoneOptions, onRange, onZone }: Props) {
  // Si el período por defecto de los ajustes no es uno de los tres, se suma como chip.
  const ranges = range && !BASE_RANGES.includes(range) ? [...BASE_RANGES, range] : BASE_RANGES;
  const zones =
    zone && !zoneOptions.some((z) => z.id === zone) ? [...zoneOptions, { id: zone, label: zone }] : zoneOptions;

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
        {ranges.map((key) => (
          <button key={key} type="button" className="exec-chip" aria-pressed={range === key} onClick={() => onRange(key)}>
            {BASE_LABELS[key] ?? RANGE_LABELS[key]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 min-w-0 text-xs font-bold exec-muted">
        Zona
        <select value={zone ?? ""} onChange={(e) => onZone(e.target.value || null)}>
          <option value="">Todas las zonas</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
