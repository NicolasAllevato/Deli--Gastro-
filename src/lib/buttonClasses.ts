import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 font-bold tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/60";

const VARIANT: Record<ButtonVariant, string> = {
  // Verde oliva — acción principal, contraste 4.84:1 sobre #f0f3f8 ✓ WCAG AA
  primary:   "rounded-full text-white btn-glow",
  // Beige neumórfico — acción secundaria; color por tema (globals.css)
  secondary: "rounded-full text-[var(--app-btn-secondary)] neumorphic neumorphic-hover",
  // Ghost — texto oliva sobre fondo transparente; color por tema (globals.css)
  ghost:     "rounded-full text-[var(--app-btn-ghost)] hover:text-[var(--app-accent-text)] hover:bg-[var(--app-btn-ghost-hover)]",
  // Danger — rojo sobrio con sombra contenida
  danger:    "rounded-full text-white bg-[#c0392b] hover:bg-[#a93226] shadow-[0_4px_12px_rgba(192,57,43,0.28)]",
  // Icon — estado hover en oliva en lugar de naranja
  icon:      "rounded-full neumorphic neumorphic-hover text-gray-500 hover:text-[var(--app-accent-text)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "py-4 px-6 text-sm",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "w-9 h-9",
  md: "w-10 h-10",
  lg: "w-12 h-12",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md"
): string {
  return cn(BASE, VARIANT[variant], variant === "icon" ? ICON_SIZE[size] : SIZE[size]);
}
