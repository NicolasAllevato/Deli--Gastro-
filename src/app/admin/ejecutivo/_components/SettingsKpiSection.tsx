"use client";

import { Field, Switch } from "@/components/ui";
import { KPI_KEYS, type ExecutiveSettings, type GoodDirection, type KpiKey } from "@/lib/reports/executiveSettings";
import { KPI_LABELS } from "./format";
import { fromNumber, toNumber, withDirection, withKpi } from "./settingsDraft";

interface Props {
  draft: ExecutiveSettings;
  onChange: (next: ExecutiveSettings) => void;
}

function KpiRow({ kpi, draft, onChange }: Props & { kpi: KpiKey }) {
  const s = draft.kpis[kpi];
  return (
    <fieldset className="rounded-2xl neumorphic-inset p-4 flex flex-col gap-3 min-w-0">
      <legend className="px-2 text-sm font-black text-gray-800">{KPI_LABELS[kpi]}</legend>
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
        La alerta se activa cuando el valor está más allá del umbral, del lado malo de la meta.
      </p>
      {KPI_KEYS.map((kpi) => (
        <KpiRow key={kpi} kpi={kpi} draft={draft} onChange={onChange} />
      ))}
    </section>
  );
}
