import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "green" | "red" | "blue" | "yellow" | "orange";

interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function Badge({ tone, children, icon, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold",
        `badge-${tone}`,
        className
      )}
    >
      {icon !== undefined && icon}
      {children}
    </span>
  );
}
