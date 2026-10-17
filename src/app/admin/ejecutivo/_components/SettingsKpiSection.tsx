"use client";

import { Field, Switch } from "@/components/ui";
import { KPI_KEYS, type ExecutiveSettings, type GoodDirection, type KpiKey } from "@/lib/reports/executiveSettings";
import { KPI_LABELS } from "./format";
import { fromNumber, toNumber, withDirection, withKpi } from "./settingsDraft";

/** Explicación corta de cada indicador: qué mide, de dónde sale y en qué unidad se escribe. */
const KPI_HELP: Record<KpiKey, { what: string; unit: string; example: string }> = {
  onTime: {
    what: "Porcentaje de pedidos entregados dentro del tiempo prometido según la zona. Los que siguen en curso y ya se pasaron cuentan como tarde.",
    unit: "%",
    example: "Meta 90 y alerta 80: si menos de 8 de cada 10 llegan a tiempo, se marca.",
  },
  prepMinutes: {
    what: "Minutos promedio desde que entra el pedido hasta que la cocina lo marca listo para enviar.",
    unit: "minutos",
    example: "Meta 18 y alerta 25: si la cocina tarda más de 25 min en promedio, se marca.",
  },
  csat: {
    what: "Promedio de estrellas (1 a 5) de las reseñas que dejan los clientes después de recibir el pedido.",
    unit: "estrellas, de 1 a 5",
    example: "Meta 4.5 y alerta 4: si el promedio baja de 4 estrellas, se marca.",
  },
  complaints: {
    what: "Porcentaje de pedidos entregados que recibieron una reseña de 3 estrellas o menos.",
    unit: "%",
    example: "Meta 3 y alerta 6: si más de 6 de cada 100 pedidos tienen reseña baja, se marca.",
  },
  avgTicket: {
    what: "Importe promedio por pedido (total facturado dividido la cantidad de pedidos).",
    unit: "pesos",
    example: "Meta 8000 y alerta 5000: si el ticket promedio baja de $5.000, se marca.",
  },
};

interface Props {
  draft: ExecutiveSettings;
  onChange: (next: ExecutiveSettings) => void;
}

function KpiRow({ kpi, draft, onChange }: Props & { kpi: KpiKey }) {
  const s = draft.kpis[kpi];
  const help = KPI_HELP[kpi];
  return (
    <fieldset className="rounded-2xl neumorphic-inset p-4 flex flex-col gap-3 min-w-0">
      <legend className="px-2 text-sm font-black text-gray-800">{KPI_LABELS[kpi]}</legend>
      <div className="text-xs text-gray-600 leading-relaxed">
        <p>{help.what}</p>
        <p className="mt-1 text-gray-500">
          Se escribe en <strong className="text-gray-700">{help.unit}</strong>. {help.example}
        </p>
      </div>
      <Switch
        label="Mostrar en el tablero"
        checked={s.visible}
        onChange={(visible) => onChange(withKpi(draft, kpi, { visible }))}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Meta"
          type="number"
          inputMode="decimal"
          className="py-2.5 px-4"
          value={fromNumber(s.target)}
          onChange={(e) => onChange(withKpi(draft, kpi, { target: toNumber(e.target.value) }))}
        />
        <Field
          label="Umbral de alerta"
          type="number"
          inputMode="decimal"
          className="py-2.5 px-4"
          value={fromNumber(s.alertThreshold)}
          onChange={(e) => onChange(withKpi(draft, kpi, { alertThreshold: toNumber(e.target.value) }))}
        />
      </div>
      <label className="block text-xs font-bold text-gray-600 uppercase tracking-widest">
        Qué es mejor
        <select
          className="mt-2 w-full rounded-2xl px-4 py-2.5 text-sm font-bold text-gray-800 bg-white border border-gray-300"
          value={s.direction}
          onChange={(e) => onChange(withDirection(draft, kpi, e.target.value as GoodDirection))}
        >
          <option value="higher">Cuanto más alto, mejor</option>
          <option value="lower">Cuanto más bajo, mejor</option>
        </select>
      </label>
    </fieldset>
  );
}

export function SettingsKpiSection({ draft, onChange }: Props) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="aj-kpis">
      <h3 id="aj-kpis" className="font-headline font-black text-gray-800">Indicadores</h3>
      <p className="text-xs text-gray-600">
        <strong>Meta</strong>: el valor al que querés llegar. <strong>Umbral de alerta</strong>: desde dónde el
        indicador se marca en rojo en el resumen. Siempre va del lado malo de la meta (más bajo si “más alto es
        mejor”, más alto si “más bajo es mejor”).
      </p>
      {KPI_KEYS.map((kpi) => (
        <KpiRow key={kpi} kpi={kpi} draft={draft} onChange={onChange} />
      ))}
    </section>
  );
}
