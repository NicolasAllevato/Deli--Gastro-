"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  buttonClasses,
  type ButtonVariant,
  type ButtonSize,
} from "@/lib/buttonClasses";

export { buttonClasses, type ButtonVariant, type ButtonSize };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  leftIcon,
  rightIcon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  if (process.env.NODE_ENV === "development") {
    if (variant === "icon" && !props["aria-label"]) {
      console.warn("Button variant=icon requiere aria-label");
    }
  }

  return (
    <button
      className={cn(
        buttonClasses(variant, size),
        fullWidth && "w-full",
        className
      )}
      disabled={disabled ?? loading}
      aria-busy={loading ? true : undefined}
      {...props}
    >
      {loading ? (
        <Loader2 className="animate-spin" size={16} />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
