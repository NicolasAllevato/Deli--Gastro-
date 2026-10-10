"use client";

import { Moon, Sun } from "lucide-react";
import type { ExecTheme } from "./useExecTheme";

interface Props {
  theme: ExecTheme;
  onChange: (theme: ExecTheme) => void;
}

const OPTIONS = [
  { value: "light" as const, label: "Claro", Icon: Sun },
  { value: "dark" as const, label: "Oscuro", Icon: Moon },
];

export function ThemeToggle({ theme, onChange }: Props) {
  return (
    <div role="group" aria-label="Tema del tablero" className="flex gap-2">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="exec-chip"
          aria-pressed={theme === value}
          onClick={() => onChange(value)}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
