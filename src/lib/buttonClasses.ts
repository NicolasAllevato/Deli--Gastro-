import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 font-bold tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/60";

const VARIANT: Record<ButtonVariant, string> = {
  primary:   "rounded-full text-white btn-glow",
  secondary: "rounded-full text-gray-600 neumorphic neumorphic-hover",
  ghost:     "rounded-full text-gray-600 hover:text-brand-orange hover:bg-gray-100",
  danger:    "rounded-full text-white bg-red-500 hover:opacity-90 shadow-[0_4px_12px_rgba(239,68,68,0.3)]",
  icon:      "rounded-full neumorphic neumorphic-hover text-gray-500 hover:text-brand-orange",
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
