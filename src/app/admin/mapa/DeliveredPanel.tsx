"use client";

import Link from "next/link";
import { formatOrderId } from "@/lib/orders";
import { deliveredPoint } from "@/lib/delivery-metrics";
import { ALL, CHANNEL_MARKER, channelLabel, deliveredChannel, DELIVERED_CHANNELS, LIST_LIMIT, MAX_MARKERS, MAX_RANGE_DAYS, NO_COURIER, type DeliveredChannel, type DeliveredMapResponse, type DeliveredPreset } from "@/lib/delivered-map";
import type { DeliveredFilterState, DeliveredMapState } from "./useDeliveredMap";

const PRESETS: ReadonlyArray<{ value: DeliveredPreset; label: string }> = [
  { value: "hoy", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "custom", label: "Personalizado" },
];

const FIELD = "px-3 py-2 rounded-xl neumorphic-inset text-sm text-gray-700 outline-none focus:ring-2 focus:ring-brand-orange/40";

interface FiltersProps {
  filters: DeliveredFilterState;
  couriers: readonly string[];
  onChange: (patch: Partial<DeliveredFilterState>) => void;
}

export function DeliveredFilters({ filters, couriers, onChange }: FiltersProps) {
  // Un repartidor elegido sigue en la lista aunque no tenga entregas en el rango nuevo.
  const options = filters.courier === ALL || filters.courier === NO_COURIER || couriers.includes(filters.courier) ? couriers : [filters.courier, ...couriers];
  return (
    <div className="neumorphic rounded-2xl p-3 space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rango de fechas">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={filters.preset === p.value}
            onClick={() => onChange({ preset: p.value })}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filters.preset === p.value ? "bg-brand-orange text-white" : "neumorphic neumorphic-hover text-gray-600"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {filters.preset === "custom" && (
        <div className="flex flex-wrap gap-2">
          <input type="date" aria-label="Desde" value={filters.customFrom} onChange={(e) => onChange({ customFrom: e.target.value })} className={FIELD} />
          <input type="date" aria-label="Hasta" value={filters.customTo} onChange={(e) => onChange({ customTo: e.target.value })} className={FIELD} />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select aria-label="Canal" value={filters.channel} onChange={(e) => onChange({ channel: e.target.value as DeliveredFilterState["channel"] })} className={FIELD}>
          <option value={ALL}>Todos los canales</option>
          {DELIVERED_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select aria-label="Repartidor" value={filters.courier} onChange={(e) => onChange({ courier: e.target.value })} className={FIELD}>
          <option value={ALL}>Todos los repartidores</option>
          <option value={NO_COURIER}>Sin repartidor</option>
          {options.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="neumorphic-inset rounded-xl p-3 text-center">
      <p data-testid={testId} className="font-headline font-black text-xl text-gray-800">{value}</p>
      <p className="text-[11px] font-bold text-gray-500">{label}</p>
    </div>
  );
}

function ChannelDot({ channel }: { channel: DeliveredChannel }) {
  const { color, letter } = CHANNEL_MARKER[channel];
  return (
    <span aria-hidden className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black text-white shrink-0" style={{ background: color }}>
      {letter}
    </span>
  );
}

function ChannelLegend({ data }: { data: DeliveredMapResponse }) {
  if (data.channels.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1" aria-label="Resumen de entregas">
      {data.channels.map((c) => (
        <li key={c.channel} data-testid={`canal-${c.channel}`} className="flex items-center gap-1.5 text-xs text-gray-600">
          <ChannelDot channel={c.channel} />
          <span className="font-bold">{channelLabel(c.channel)}</span>
          <span>{c.total}{c.located < c.total ? ` (${c.located} en el mapa)` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function notices(data: DeliveredMapResponse): string[] {
  const out: string[] = [];
  if (data.summary.withoutLocation > 0) {
    out.push(`${data.summary.withoutLocation} no se pueden marcar en el mapa${data.summary.withoutAddress > 0 ? `; ${data.summary.withoutAddress} no tienen dirección (PedidosYa y Rappi no la informan)` : ""}.`);
  }
  if (data.summary.located > MAX_MARKERS) out.push(`El mapa muestra las ${MAX_MARKERS} entregas más recientes de ${data.summary.located}.`);
  if (data.truncated) out.push("Hay más pedidos de los que se pueden leer de una vez: los números son un mínimo. Achicá el rango.");
  return out;
}

export function DeliveredPanel({ state }: { state: DeliveredMapState }) {
  const { data, loading, error, invalidRange } = state;
  if (invalidRange) {
    return <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">Elegí una fecha desde y hasta válidas (máximo {MAX_RANGE_DAYS} días).</div>;
  }
  return (
    <div className="space-y-3" aria-busy={loading}>
      {error && <p role="alert" className="badge-red rounded-xl px-3 py-2 text-xs font-bold">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Entregados" value={data.summary.total} testId="entregados-total" />
            <Stat label="En el mapa" value={data.summary.located} testId="entregados-en-mapa" />
            <Stat label="Sin ubicación" value={data.summary.withoutLocation} testId="entregados-sin-ubicacion" />
          </div>
          <ChannelLegend data={data} />
          {notices(data).map((n) => <p key={n} className="text-xs text-gray-500 px-1">{n}</p>)}
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest px-1">
            Entregados{data.summary.total > LIST_LIMIT ? ` (últimos ${LIST_LIMIT} de ${data.summary.total})` : ` (${data.summary.total})`}
          </p>
          {data.list.length === 0 ? (
            <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">No hay entregas con estos filtros.</div>
          ) : (
            <div className="space-y-2">
              {data.list.map((o) => (
                <Link key={o.id} href={`/admin/pedidos/${o.id}`} className="neumorphic rounded-xl p-3.5 flex items-center gap-3 neumorphic-hover">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-gray-800 truncate">
                      {o.client_name} <span className="text-gray-400 font-medium">· {formatOrderId(o.id)}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
                      <ChannelDot channel={deliveredChannel(o)} />
                      <span className="font-bold text-gray-600 shrink-0">{channelLabel(deliveredChannel(o))}</span>
                      <span className="truncate">· {o.delivery_address ?? "Sin dirección informada"}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-600">{o.courier_name ?? "Sin repartidor"}</p>
                    <p className="text-[11px] text-gray-500">{deliveredPoint(o) ? "En el mapa" : "Sin ubicación"}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
