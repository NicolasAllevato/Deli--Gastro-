"use client";

import { Moon, Sun } from "lucide-react";
import { useAppTheme, type AppTheme } from "@/lib/theme/useAppTheme";

const OPTIONS: readonly { value: AppTheme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Oscuro", Icon: Moon },
];

interface Props {
  className?: string;
  /** Solo íconos (para cabeceras angostas). El nombre queda para lectores de pantalla. */
  compact?: boolean;
}

/** Interruptor Claro/Oscuro de toda la app. Se monta en cada portal. */
export function ThemeToggle({ className = "", compact = false }: Props) {
  const [theme, setTheme] = useAppTheme();

  return (
    <div
      role="group"
      aria-label="Tema de la aplicación"
      className={`inline-flex gap-1 rounded-full border border-gray-300 p-1 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={compact ? `Tema ${label.toLowerCase()}` : undefined}
          title={`Tema ${label.toLowerCase()}`}
          onClick={() => setTheme(value)}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-gray-600 transition-colors aria-pressed:bg-brand-olive aria-pressed:text-white"
        >
          <Icon size={14} aria-hidden="true" />
          {compact ? null : label}
        </button>
      ))}
    </div>
  );
}
