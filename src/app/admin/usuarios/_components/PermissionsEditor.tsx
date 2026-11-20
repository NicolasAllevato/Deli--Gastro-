"use client";

import {
  ACCESS_LEVELS, ACCESS_LEVEL_LABELS, SECTIONS, SECTION_LABELS,
  type AccessLevel, type Permissions, type Section,
} from "@/lib/auth/permissions";
import { Segmented } from "./Segmented";

const LEVEL_OPTIONS = ACCESS_LEVELS.map((value) => ({ value, label: ACCESS_LEVEL_LABELS[value] }));

interface PermissionsEditorProps {
  permissions: Permissions;
  onChange: (section: Section, level: AccessLevel) => void;
  /** Dueño: todo en "Editar", fijo. */
  locked: boolean;
}

/** Nivel de acceso por sección: Ninguno, Ver o Editar. */
export function PermissionsEditor({ permissions, onChange, locked }: PermissionsEditorProps) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-2 ml-1">Acceso por sección</legend>
      {locked && <p className="text-[11px] text-gray-500 mb-2 ml-1">El dueño siempre puede editar todo y gestionar usuarios.</p>}
      <ul className="flex flex-col gap-2">
        {SECTIONS.map((section) => (
          <li key={section} className="flex flex-wrap items-center justify-between gap-2 rounded-xl neumorphic px-4 py-2.5">
            <span className="text-sm font-bold text-gray-800">{SECTION_LABELS[section]}</span>
            <Segmented
              name={`permiso-${section}`}
              legend={`Acceso a ${SECTION_LABELS[section]}`}
              hideLegend
              options={LEVEL_OPTIONS}
              value={permissions[section]}
              onChange={(level) => onChange(section, level)}
              disabled={locked}
            />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
