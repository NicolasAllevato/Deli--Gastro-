"use client";

import { Field, Switch } from "@/components/ui";
import { RULE_IDS, type ExecutiveSettings, type RuleId } from "@/lib/reports/executiveSettings";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/reports/range";
import { fromNumber, toNumber, withDropPoints, withRule } from "./settingsDraft";

interface Props {
  draft: ExecutiveSettings;
  onChange: (next: ExecutiveSettings) => void;
}

const RULE_COPY: Record<RuleId, { label: string; hint: string }> = {
  kpiAlert: { label: "Alertas de indicadores", hint: "Avisa cuando un indicador pasa el umbral de alerta." },
  kpiMiss: { label: "Indicadores fuera de meta", hint: "Avisa cuando un indicador no llega a la meta." },
  zoneDrop: { label: "Caída de puntualidad por zona", hint: "Compara cada zona con el período anterior." },
  zoneLate: { label: "Zonas con demoras", hint: "Señala zonas por debajo de la meta de puntualidad." },
};

export function SettingsCopilotSection({ draft, onChange }: Props) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="aj-copiloto">
      <h3 id="aj-copiloto" className="font-headline font-black text-gray-800">Copiloto y período</h3>
      <div className="rounded-2xl neumorphic-inset p-4 flex flex-col gap-4">
        {RULE_IDS.map((rule) => (
          <Switch
            key={rule}
            label={RULE_COPY[rule].label}
            hint={RULE_COPY[rule].hint}
            checked={draft.copilot.rules[rule]}
            onChange={(enabled) => onChange(withRule(draft, rule, enabled))}
          />
        ))}
      </div>
      <Field
        label="Caída que dispara alerta (puntos)"
        type="number"
        inputMode="decimal"
        className="py-2.5 px-4"
        hint="Puntos porcentuales de puntualidad que debe bajar una zona."
        value={fromNumber(draft.copilot.dropPoints)}
        onChange={(e) => onChange(withDropPoints(draft, toNumber(e.target.value)))}
      />
      <label className="block text-xs font-bold text-gray-600 uppercase tracking-widest ml-1">
        Período por defecto
        <select
          className="mt-2 w-full rounded-2xl px-4 py-2.5 text-sm font-bold text-gray-800 bg-white border border-gray-300"
          value={draft.defaultRange}
          onChange={(e) => onChange({ ...draft, defaultRange: e.target.value as RangeKey })}
        >
          {RANGE_KEYS.map((key) => (
            <option key={key} value={key}>{RANGE_LABELS[key]}</option>
          ))}
        </select>
      </label>
    </section>
  );
}
