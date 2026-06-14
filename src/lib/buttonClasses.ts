import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 font-bold tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6b7c45]/60";

const VARIANT: Record<ButtonVariant, string> = {
  // Verde oliva — acción principal, contraste 4.84:1 sobre #f0f3f8 ✓ WCAG AA
  primary:   "rounded-full text-white btn-glow",
  // Beige neumórfico — acción secundaria, sin agresividad visual
  secondary: "rounded-full text-[#4a3f2a] neumorphic neumorphic-hover",
  // Ghost — texto oliva sobre fondo transparente
  ghost:     "rounded-full text-[#4a5a2a] hover:text-[#5a6838] hover:bg-[#e8eddc]/60",
  // Danger — rojo sobrio con sombra contenida
  danger:    "rounded-full text-white bg-[#c0392b] hover:bg-[#a93226] shadow-[0_4px_12px_rgba(192,57,43,0.28)]",
  // Icon — estado hover en oliva en lugar de naranja
  icon:      "rounded-full neumorphic neumorphic-hover text-gray-500 hover:text-[#6b7c45]",
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
