"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Field, Switch } from "@/components/ui";
import type { ExecutiveSettings } from "@/lib/reports/executiveSettings";
import { fromNumber, toNumber, withSla, withZone, withZoneSla } from "./settingsDraft";

interface Props {
  draft: ExecutiveSettings;
  zones: Array<{ id: string; label: string }>;
  onChange: (next: ExecutiveSettings) => void;
}

function ZoneRow({ id, name, draft, onChange }: { id: string; name: string; draft: ExecutiveSettings; onChange: Props["onChange"] }) {
  const zone = draft.zones[id];
  const override = Object.hasOwn(draft.sla.byZone, id) ? draft.sla.byZone[id] : null;
  return (
    <fieldset className="rounded-2xl neumorphic-inset p-4 flex flex-col gap-3 min-w-0">
      <legend className="px-2 text-sm font-black text-gray-800 max-w-full truncate">{name}</legend>
      <Switch
        label="Mostrar en el filtro"
        checked={zone?.visible ?? true}
        onChange={(visible) => onChange(withZone(draft, id, { visible }))}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Etiqueta"
          maxLength={40}
          className="py-2.5 px-4"
          placeholder={name}
          value={zone?.label ?? ""}
          onChange={(e) => onChange(withZone(draft, id, { label: e.target.value }))}
        />
        <Field
          label="Minutos prometidos"
          type="number"
          inputMode="numeric"
          className="py-2.5 px-4"
          placeholder={String(draft.sla.defaultMinutes)}
          hint="Vacío = usa el valor por defecto"
          value={override === null ? "" : fromNumber(override)}
          onChange={(e) => onChange(withZoneSla(draft, id, e.target.value.trim() === "" ? null : toNumber(e.target.value)))}
        />
      </div>
    </fieldset>
  );
}

export function SettingsZonesSection({ draft, zones, onChange }: Props) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="aj-tiempos">
      <h3 id="aj-tiempos" className="font-headline font-black text-gray-800">Tiempos y zonas</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Minutos prometidos (por defecto)"
          type="number"
          inputMode="numeric"
          className="py-2.5 px-4"
          value={fromNumber(draft.sla.defaultMinutes)}
          onChange={(e) => onChange(withSla(draft, { defaultMinutes: toNumber(e.target.value) }))}
        />
        <Field
          label="Tolerancia de retraso (min)"
          type="number"
          inputMode="numeric"
          className="py-2.5 px-4"
          value={fromNumber(draft.sla.toleranceMinutes)}
          onChange={(e) => onChange(withSla(draft, { toleranceMinutes: toNumber(e.target.value) }))}
        />
      </div>
      {zones.length === 0 ? (
        <p className="text-xs text-gray-600">Todavía no hay zonas con pedidos.</p>
      ) : (
        zones.map((z) => <ZoneRow key={z.id} id={z.id} name={z.label} draft={draft} onChange={onChange} />)
      )}
      <Link href="/admin/zonas" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-olive-hover underline">
        Crear o editar zonas en el mapa
        <ExternalLink size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}
